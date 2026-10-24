// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title NativeGameVault
/// @notice MON balances and bounded room escrow. The operator determines game results offchain.
/// @dev A fresh, non-upgradeable deployment; NOT a storage-compatible upgrade of the legacy USDC vault.
///      No external transfers during settlement/refund. Dust remains a separate liability with no sweep function.
contract NativeGameVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    enum Status {
        None,
        Waiting,
        Active,
        Settled,
        Cancelled
    }

    struct Room {
        uint256 bidWei;
        uint8 maxPlayers;
        Status status;
        uint64 joinDeadline;
        uint64 settlementDeadline;
        bytes32 rosterHash;
        bytes32 resultHash;
        uint256 dustWei;
        address[] players;
    }

    struct Entry {
        bool joined;
        uint256 skillBudgetWei;
    }

    struct JoinTicket {
        bytes32 roomId;
        address player;
        uint256 skillBudgetWei;
        uint256 nonce;
        uint64 deadline;
    }

    uint256 public constant MIN_BID = 1 ether;
    uint256 public constant ROUNDING_UNIT = 0.01 ether;
    uint8 public constant MIN_PLAYERS = 2;
    uint8 public constant MAX_PLAYERS = 10;
    uint64 public constant ACTIVE_TIMEOUT = 15 minutes;
    uint64 public constant MAX_JOIN_WINDOW = 1 days;
    bytes32 public constant JOIN_TICKET_TYPEHASH =
        keccak256("JoinTicket(bytes32 roomId,address player,uint256 skillBudgetWei,uint256 nonce,uint64 deadline)");

    address public operator;
    address public backendSigner;
    address public immutable treasury;
    uint256 public totalAvailableBalance;
    uint256 public totalBidLocked;
    uint256 public totalSkillReserved;
    uint256 public totalTreasuryClaimable;
    uint256 public totalRoomDust;

    mapping(address => uint256) public nonces;
    mapping(address => bytes32) public activeRoomOf;
    mapping(address => uint256) private available;
    mapping(address => uint256) private bidLocked;
    mapping(address => uint256) private skillReserved;
    mapping(bytes32 => Room) private rooms;
    mapping(bytes32 => mapping(address => Entry)) private entries;

    error InvalidAddress();
    error UnauthorizedOperator();
    error UnauthorizedTreasury();
    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidRoom();
    error InvalidTerms();
    error InvalidStatus(Status actual);
    error DeadlineExpired();
    error RefundNotAvailable();
    error InvalidTicket();
    error PlayerAlreadyActive();
    error RoomFull();
    error NotInRoom();
    error NotEnoughPlayers();
    error RosterMismatch();
    error InvalidSettlement();
    error InvalidRecipient();
    error InvalidSkillFee();

    event OperatorUpdated(address indexed operator);
    event BackendSignerUpdated(address indexed signer);
    event Deposited(address indexed player, uint256 amountWei);
    event Withdrawn(address indexed player, uint256 amountWei);
    event RoomCreated(bytes32 indexed roomId, uint256 bidWei, uint8 maxPlayers, uint64 joinDeadline);
    event PlayerJoined(bytes32 indexed roomId, address indexed player, uint256 skillBudgetWei, uint256 nonce);
    event PlayerLeft(bytes32 indexed roomId, address indexed player);
    event RoomStarted(bytes32 indexed roomId, bytes32 rosterHash, uint64 settlementDeadline);
    event SkillFeeCharged(bytes32 indexed roomId, address indexed player, uint256 amountWei);
    event PayoutCredited(bytes32 indexed roomId, address indexed player, uint256 amountWei);
    event RoomSettled(bytes32 indexed roomId, bytes32 indexed resultHash, uint256 potWei, uint256 dustWei);
    event RoomCancelled(bytes32 indexed roomId, bool expiredActive);
    event TreasuryWithdrawn(uint256 amountWei);

    constructor(address initialOwner, address initialOperator, address initialSigner, address treasuryAddress)
        Ownable(initialOwner)
        EIP712("DorPrizeNativeGameVault", "1")
    {
        if (
            initialOperator == address(0) || initialSigner == address(0) || treasuryAddress == address(0)
                || treasuryAddress == address(this)
        ) revert InvalidAddress();
        operator = initialOperator;
        backendSigner = initialSigner;
        treasury = treasuryAddress;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator();
        _;
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidAddress();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    /// @notice Pausing stops new deposits/rooms/joins/starts, but never blocks withdrawals or recovery.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function deposit() external payable whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        available[msg.sender] += msg.value;
        totalAvailableBalance += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Only the unencumbered portion may be withdrawn, including during an active match.
    function withdraw(uint256 amountWei) external nonReentrant {
        if (amountWei == 0) revert ZeroAmount();
        if (amountWei > available[msg.sender]) revert InsufficientBalance();
        available[msg.sender] -= amountWei;
        totalAvailableBalance -= amountWei;
        emit Withdrawn(msg.sender, amountWei);
        _send(payable(msg.sender), amountWei);
    }

    function createRoom(bytes32 roomId, uint256 bidWei, uint8 maxPlayers, uint64 joinDeadline)
        external
        onlyOperator
        whenNotPaused
    {
        if (roomId == bytes32(0) || rooms[roomId].status != Status.None) revert InvalidRoom();
        if (
            bidWei < MIN_BID || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS || joinDeadline <= block.timestamp
                || joinDeadline > block.timestamp + MAX_JOIN_WINDOW
        ) {
            revert InvalidTerms();
        }
        Room storage room = rooms[roomId];
        room.bidWei = bidWei;
        room.maxPlayers = maxPlayers;
        room.status = Status.Waiting;
        room.joinDeadline = joinDeadline;
        emit RoomCreated(roomId, bidWei, maxPlayers, joinDeadline);
    }

    /// @notice The signature binds player, room, approved reserve, nonce, deadline, chain and vault.
    function joinRoom(JoinTicket calldata ticket, bytes calldata signature) external whenNotPaused nonReentrant {
        Room storage room = _roomAt(ticket.roomId, Status.Waiting);
        if (block.timestamp >= room.joinDeadline || block.timestamp > ticket.deadline) revert DeadlineExpired();
        if (
            ticket.player != msg.sender || ticket.nonce != nonces[msg.sender]
                || !SignatureChecker.isValidSignatureNow(backendSigner, hashJoinTicket(ticket), signature)
        ) {
            revert InvalidTicket();
        }
        if (activeRoomOf[msg.sender] != bytes32(0)) revert PlayerAlreadyActive();
        if (room.players.length >= room.maxPlayers) revert RoomFull();
        uint256 locked = room.bidWei + ticket.skillBudgetWei;
        if (locked > available[msg.sender]) revert InsufficientBalance();

        nonces[msg.sender]++;
        available[msg.sender] -= locked;
        totalAvailableBalance -= locked;
        bidLocked[msg.sender] = room.bidWei;
        totalBidLocked += room.bidWei;
        skillReserved[msg.sender] = ticket.skillBudgetWei;
        totalSkillReserved += ticket.skillBudgetWei;
        activeRoomOf[msg.sender] = ticket.roomId;
        entries[ticket.roomId][msg.sender] = Entry(true, ticket.skillBudgetWei);
        room.players.push(msg.sender);
        emit PlayerJoined(ticket.roomId, msg.sender, ticket.skillBudgetWei, ticket.nonce);
    }

    function leaveRoom(bytes32 roomId) external {
        Room storage room = _roomAt(roomId, Status.Waiting);
        if (!entries[roomId][msg.sender].joined) revert NotInRoom();
        for (uint256 i; i < room.players.length; i++) {
            if (room.players[i] == msg.sender) {
                room.players[i] = room.players[room.players.length - 1];
                room.players.pop();
                break;
            }
        }
        _release(roomId, msg.sender, room.bidWei);
        // Keep the room identity and immutable terms even when its last player leaves.
        emit PlayerLeft(roomId, msg.sender);
    }

    /// @notice Fails on any roster change mined before this transaction; no silent start with a stale roster.
    function startRoom(bytes32 roomId, bytes32 expectedRosterHash) external onlyOperator whenNotPaused {
        Room storage room = _roomAt(roomId, Status.Waiting);
        if (block.timestamp >= room.joinDeadline) revert DeadlineExpired();
        if (room.players.length < MIN_PLAYERS) revert NotEnoughPlayers();
        bytes32 roster = keccak256(abi.encode(room.players));
        if (expectedRosterHash != roster) revert RosterMismatch();
        room.rosterHash = roster;
        room.status = Status.Active;
        room.settlementDeadline = uint64(block.timestamp + ACTIVE_TIMEOUT);
        emit RoomStarted(roomId, roster, room.settlementDeadline);
    }

    /// @notice Operator supplies the persisted server result. Fees are ordered by the frozen roster.
    /// @dev The contract checks accounting and membership, not whether the game result is honest.
    function settleRoom(
        bytes32 roomId,
        address[] calldata recipients,
        uint256[] calldata amountsWei,
        uint256[] calldata skillFeesWei,
        bytes32 expectedRosterHash,
        bytes32 resultHash
    ) external onlyOperator {
        Room storage room = _roomAt(roomId, Status.Active);
        if (block.timestamp >= room.settlementDeadline) revert DeadlineExpired();
        if (expectedRosterHash != room.rosterHash) revert RosterMismatch();
        uint256 count = recipients.length;
        if (
            count == 0 || count > room.players.length || amountsWei.length != count
                || skillFeesWei.length != room.players.length || resultHash == bytes32(0)
        ) {
            revert InvalidSettlement();
        }
        uint256 pot = room.bidWei * room.players.length;
        uint256 payout = count == 1 ? pot : (pot / count / ROUNDING_UNIT) * ROUNDING_UNIT;
        for (uint256 i; i < count; i++) {
            if (!entries[roomId][recipients[i]].joined) revert InvalidRecipient();
            if (amountsWei[i] != payout) revert InvalidSettlement();
            for (uint256 j; j < i; j++) {
                if (recipients[j] == recipients[i]) revert InvalidRecipient();
            }
        }
        // State is terminal before any further work. All credits are internal, and reverts are atomic.
        room.status = Status.Settled;
        room.resultHash = resultHash;
        room.dustWei = pot - payout * count;
        totalRoomDust += room.dustWei;
        totalBidLocked -= pot;
        _consumeEntries(roomId, room, skillFeesWei);
        for (uint256 i; i < count; i++) {
            available[recipients[i]] += payout;
            totalAvailableBalance += payout;
            emit PayoutCredited(roomId, recipients[i], payout);
        }
        emit RoomSettled(roomId, resultHash, pot, room.dustWei);
    }

    function _consumeEntries(bytes32 roomId, Room storage room, uint256[] calldata skillFeesWei) private {
        for (uint256 i; i < room.players.length; i++) {
            address player = room.players[i];
            uint256 budget = entries[roomId][player].skillBudgetWei;
            uint256 fee = skillFeesWei[i];
            if (fee > budget || fee % ROUNDING_UNIT != 0) revert InvalidSkillFee();
            bidLocked[player] = 0;
            skillReserved[player] = 0;
            delete activeRoomOf[player];
            totalSkillReserved -= budget;
            available[player] += budget - fee;
            totalAvailableBalance += budget - fee;
            totalTreasuryClaimable += fee;
            emit SkillFeeCharged(roomId, player, fee);
        }
    }

    /// @notice Operator can cancel a lobby immediately; anyone can recover it at/after its deadline.
    function cancelWaitingRoom(bytes32 roomId) external {
        Room storage room = _roomAt(roomId, Status.Waiting);
        if (msg.sender != operator && block.timestamp < room.joinDeadline) revert RefundNotAvailable();
        _cancel(roomId, room, false);
    }

    /// @notice Permissionless recovery, independent of the operator, with no skill fees charged.
    function refundExpiredRoom(bytes32 roomId) external {
        Room storage room = _roomAt(roomId, Status.Active);
        if (block.timestamp < room.settlementDeadline) revert RefundNotAvailable();
        _cancel(roomId, room, true);
    }

    function withdrawTreasury(uint256 amountWei) external nonReentrant {
        if (msg.sender != treasury) revert UnauthorizedTreasury();
        if (amountWei == 0) revert ZeroAmount();
        if (amountWei > totalTreasuryClaimable) revert InsufficientBalance();
        totalTreasuryClaimable -= amountWei;
        emit TreasuryWithdrawn(amountWei);
        _send(payable(treasury), amountWei);
    }

    function hashJoinTicket(JoinTicket memory ticket) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    JOIN_TICKET_TYPEHASH,
                    ticket.roomId,
                    ticket.player,
                    ticket.skillBudgetWei,
                    ticket.nonce,
                    ticket.deadline
                )
            )
        );
    }

    function getRoom(bytes32 roomId) external view returns (Room memory) {
        return rooms[roomId];
    }

    function getEntry(bytes32 roomId, address player) external view returns (Entry memory) {
        return entries[roomId][player];
    }

    function currentRosterHash(bytes32 roomId) external view returns (bytes32) {
        return keccak256(abi.encode(rooms[roomId].players));
    }

    function availableBalanceOf(address player) external view returns (uint256) {
        return available[player];
    }

    function lockedBalanceOf(address player) external view returns (uint256) {
        return bidLocked[player];
    }

    function skillReservedOf(address player) external view returns (uint256) {
        return skillReserved[player];
    }

    function totalLiabilities() public view returns (uint256) {
        return totalAvailableBalance + totalBidLocked + totalSkillReserved + totalTreasuryClaimable + totalRoomDust;
    }

    function _roomAt(bytes32 roomId, Status status) private view returns (Room storage room) {
        room = rooms[roomId];
        if (room.status != status) revert InvalidStatus(room.status);
    }

    function _release(bytes32 roomId, address player, uint256 bid) private {
        uint256 budget = entries[roomId][player].skillBudgetWei;
        delete entries[roomId][player];
        delete activeRoomOf[player];
        bidLocked[player] = 0;
        skillReserved[player] = 0;
        totalBidLocked -= bid;
        totalSkillReserved -= budget;
        available[player] += bid + budget;
        totalAvailableBalance += bid + budget;
    }

    function _cancel(bytes32 roomId, Room storage room, bool expiredActive) private {
        room.status = Status.Cancelled;
        for (uint256 i; i < room.players.length; i++) {
            _release(roomId, room.players[i], room.bidWei);
        }
        emit RoomCancelled(roomId, expiredActive);
    }

    function _send(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
