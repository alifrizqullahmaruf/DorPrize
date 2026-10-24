// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {GameVault} from "./GameVault.sol";

/// @title RoomManager
/// @notice On-chain money flow for DOR PRIZE rooms. The backend runs the game; the chain only
///         locks bids, pays the pot and charges skill fees.
///
/// Lifecycle:
///   joinRoom (ticket signed by backend)  -> Open      bid locked in the vault
///   leaveRoom                            -> Open      bid returned (only before start)
///   startRoom (operator / relayer)       -> Started   nobody can leave any more
///   settleRoom (anyone, backend-signed)  -> Settled   pot split between winners, fees to treasury
///   refundRoom (anyone, after delay)     -> Refunded  every bid returned
contract RoomManager is Initializable, OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, PausableUpgradeable {
    using ECDSA for bytes32;

    enum Status {
        None,
        Open,
        Started,
        Settled,
        Refunded
    }

    struct Room {
        uint256 bid;
        uint8 maxPlayers;
        Status status;
        uint64 createdAt;
        uint64 startedAt;
        address[] players;
    }

    uint8 public constant MIN_PLAYERS = 2;
    uint8 public constant MAX_PLAYERS = 10;
    /// @notice 1 USDC (6 decimals).
    uint256 public constant MIN_BID = 1e6;
    uint64 public constant DEFAULT_REFUND_DELAY = 1 hours;

    bytes32 public constant JOIN_TICKET_TYPEHASH =
        keccak256("JoinTicket(bytes32 roomId,address player,uint256 bid,uint8 maxPlayers,uint64 deadline)");
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("Settlement(bytes32 roomId,address[] winners,uint256[] skillFees,uint64 deadline)");

    error InvalidAddress(address account);
    error InvalidRefundDelay(uint64 delay);
    error InvalidRoomId();
    error InvalidBid(uint256 bid);
    error InvalidMaxPlayers(uint8 maxPlayers);
    error TicketExpired(uint64 deadline);
    error InvalidSignature(address recovered, address expected);
    error RoomNotOpen(bytes32 roomId, Status status);
    error RoomNotStarted(bytes32 roomId, Status status);
    error RoomTermsMismatch(uint256 bid, uint8 maxPlayers);
    error RoomFull(bytes32 roomId);
    error AlreadyInRoom(bytes32 roomId, address player);
    error NotInRoom(bytes32 roomId, address player);
    error NotEnoughPlayers(uint256 players);
    error UnauthorizedOperator(address account);
    error InvalidWinners();
    error SkillFeesLengthMismatch(uint256 expected, uint256 actual);
    error RefundNotAvailable(uint64 availableAt);
    error RoomAlreadyClosed(bytes32 roomId, Status status);

    event BackendSignerUpdated(address indexed signer);
    event OperatorUpdated(address indexed operator);
    event VaultUpdated(address indexed vault);
    event RefundDelayUpdated(uint64 delay);
    event RoomCreated(bytes32 indexed roomId, uint256 bid, uint8 maxPlayers);
    event PlayerJoined(bytes32 indexed roomId, address indexed player, uint256 bid);
    event PlayerLeft(bytes32 indexed roomId, address indexed player);
    event RoomStarted(bytes32 indexed roomId, uint256 players);
    event RoomSettled(bytes32 indexed roomId, address[] winners, uint256 payoutEach, uint256 skillFeesCharged);
    event RoomRefunded(bytes32 indexed roomId, uint256 players);

    GameVault public vault;
    address public backendSigner;
    address public operator;
    uint64 public refundDelay;

    mapping(bytes32 roomId => Room room) private rooms;
    mapping(bytes32 roomId => mapping(address player => bool joined)) private joined;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert UnauthorizedOperator(msg.sender);
        _;
    }

    function initialize(
        address initialOwner,
        address vaultAddress,
        address signer,
        address operatorAddress,
        uint64 initialRefundDelay
    ) external initializer {
        __Ownable_init(initialOwner);
        __EIP712_init("DorPrizeRoomManager", "1");
        __Pausable_init();
        _setVault(vaultAddress);
        _setBackendSigner(signer);
        _setOperator(operatorAddress);
        _setRefundDelay(initialRefundDelay == 0 ? DEFAULT_REFUND_DELAY : initialRefundDelay);
    }

    // ---------------------------------------------------------------- admin

    function setBackendSigner(address signer) external onlyOwner {
        _setBackendSigner(signer);
    }

    function setOperator(address operatorAddress) external onlyOwner {
        _setOperator(operatorAddress);
    }

    function setVault(address vaultAddress) external onlyOwner {
        _setVault(vaultAddress);
    }

    function setRefundDelay(uint64 delay) external onlyOwner {
        _setRefundDelay(delay);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- players

    /// @notice Join a room with a backend-signed ticket and lock `bid` from the vault.
    /// @dev The first player creates the room with these terms; later players must match them.
    function joinRoom(bytes32 roomId, uint256 bid, uint8 maxPlayers, uint64 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        if (roomId == bytes32(0)) revert InvalidRoomId();
        // Deadlines/refund windows are minutes long; validator timestamp drift is irrelevant.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert TicketExpired(deadline);
        _verify(hashJoinTicket(roomId, msg.sender, bid, maxPlayers, deadline), signature);

        Room storage room = rooms[roomId];
        if (room.status == Status.None) {
            if (bid < MIN_BID) revert InvalidBid(bid);
            if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) revert InvalidMaxPlayers(maxPlayers);
            room.bid = bid;
            room.maxPlayers = maxPlayers;
            room.status = Status.Open;
            room.createdAt = uint64(block.timestamp);
            emit RoomCreated(roomId, bid, maxPlayers);
        } else {
            if (room.status != Status.Open) revert RoomNotOpen(roomId, room.status);
            if (bid != room.bid || maxPlayers != room.maxPlayers) revert RoomTermsMismatch(room.bid, room.maxPlayers);
        }
        if (joined[roomId][msg.sender]) revert AlreadyInRoom(roomId, msg.sender);
        if (room.players.length >= room.maxPlayers) revert RoomFull(roomId);

        joined[roomId][msg.sender] = true;
        room.players.push(msg.sender);
        vault.lockBid(msg.sender, roomId, bid);
        emit PlayerJoined(roomId, msg.sender, bid);
    }

    /// @notice Leave before the game starts; the bid goes back to the available balance.
    function leaveRoom(bytes32 roomId) external {
        Room storage room = rooms[roomId];
        if (room.status != Status.Open) revert RoomNotOpen(roomId, room.status);
        if (!joined[roomId][msg.sender]) revert NotInRoom(roomId, msg.sender);

        joined[roomId][msg.sender] = false;
        address[] storage players = room.players;
        for (uint256 i = 0; i < players.length; i++) {
            if (players[i] == msg.sender) {
                players[i] = players[players.length - 1];
                players.pop();
                break;
            }
        }
        uint256 bid = room.bid;
        // An empty room is forgotten so its id can be opened again with new terms.
        if (players.length == 0) delete rooms[roomId];

        vault.unlockBid(msg.sender, roomId, bid);
        emit PlayerLeft(roomId, msg.sender);
    }

    // ---------------------------------------------------------------- backend

    /// @notice Called by the backend relayer when the start countdown begins. Leaving is closed after this.
    function startRoom(bytes32 roomId) external onlyOperator whenNotPaused {
        Room storage room = rooms[roomId];
        if (room.status != Status.Open) revert RoomNotOpen(roomId, room.status);
        if (room.players.length < MIN_PLAYERS) revert NotEnoughPlayers(room.players.length);
        room.status = Status.Started;
        room.startedAt = uint64(block.timestamp);
        emit RoomStarted(roomId, room.players.length);
    }

    /// @notice Pay out a finished game. Anyone may submit it; only the backend signature makes it valid.
    /// @param winners   Seats that share the pot (1 = last survivor, more = tie).
    /// @param skillFees Skill fees per player, in the same order as `getRoom(roomId).players`.
    function settleRoom(
        bytes32 roomId,
        address[] calldata winners,
        uint256[] calldata skillFees,
        uint64 deadline,
        bytes calldata signature
    ) external whenNotPaused {
        Room storage room = rooms[roomId];
        if (room.status != Status.Started) revert RoomNotStarted(roomId, room.status);
        // Deadlines/refund windows are minutes long; validator timestamp drift is irrelevant.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert TicketExpired(deadline);
        _verify(hashSettlement(roomId, winners, skillFees, deadline), signature);

        address[] memory players = room.players;
        if (skillFees.length != players.length) revert SkillFeesLengthMismatch(players.length, skillFees.length);
        _checkWinners(roomId, winners);

        // Effects before interactions: a room can only ever be settled once.
        room.status = Status.Settled;

        uint256 payoutEach = vault.settlePot(roomId, players, room.bid, winners);
        uint256 charged;
        for (uint256 i = 0; i < players.length; i++) {
            if (skillFees[i] > 0) charged += vault.chargeSkillFee(players[i], roomId, skillFees[i]);
        }
        emit RoomSettled(roomId, winners, payoutEach, charged);
    }

    /// @notice Safety valve: if a room is not settled within `refundDelay` of its creation,
    ///         anyone can return every bid.
    function refundRoom(bytes32 roomId) external {
        Room storage room = rooms[roomId];
        if (room.status != Status.Open && room.status != Status.Started) {
            revert RoomAlreadyClosed(roomId, room.status);
        }
        uint64 availableAt = room.createdAt + refundDelay;
        // Deadlines/refund windows are minutes long; validator timestamp drift is irrelevant.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < availableAt) revert RefundNotAvailable(availableAt);

        room.status = Status.Refunded;
        address[] memory players = room.players;
        for (uint256 i = 0; i < players.length; i++) {
            vault.unlockBid(players[i], roomId, room.bid);
        }
        emit RoomRefunded(roomId, players.length);
    }

    // ---------------------------------------------------------------- views

    function getRoom(bytes32 roomId)
        external
        view
        returns (
            uint256 bid,
            uint8 maxPlayers,
            Status status,
            uint64 createdAt,
            uint64 startedAt,
            address[] memory players
        )
    {
        Room storage room = rooms[roomId];
        return (room.bid, room.maxPlayers, room.status, room.createdAt, room.startedAt, room.players);
    }

    function isInRoom(bytes32 roomId, address player) external view returns (bool) {
        return joined[roomId][player];
    }

    /// @notice EIP-712 digest the backend signs for a join ticket.
    function hashJoinTicket(bytes32 roomId, address player, uint256 bid, uint8 maxPlayers, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(JOIN_TICKET_TYPEHASH, roomId, player, bid, maxPlayers, deadline)));
    }

    /// @notice EIP-712 digest the backend signs for a settlement.
    function hashSettlement(bytes32 roomId, address[] calldata winners, uint256[] calldata skillFees, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH,
                    roomId,
                    keccak256(abi.encodePacked(winners)),
                    keccak256(abi.encodePacked(skillFees)),
                    deadline
                )
            )
        );
    }

    // ---------------------------------------------------------------- internal

    function _verify(bytes32 digest, bytes calldata signature) internal view {
        address recovered = digest.recover(signature);
        if (recovered != backendSigner) revert InvalidSignature(recovered, backendSigner);
    }

    function _checkWinners(bytes32 roomId, address[] calldata winners) internal view {
        if (winners.length == 0) revert InvalidWinners();
        for (uint256 i = 0; i < winners.length; i++) {
            if (!joined[roomId][winners[i]]) revert InvalidWinners();
            for (uint256 j = 0; j < i; j++) {
                if (winners[j] == winners[i]) revert InvalidWinners();
            }
        }
    }

    function _setVault(address vaultAddress) internal {
        if (vaultAddress == address(0)) revert InvalidAddress(vaultAddress);
        vault = GameVault(vaultAddress);
        emit VaultUpdated(vaultAddress);
    }

    function _setBackendSigner(address signer) internal {
        if (signer == address(0)) revert InvalidAddress(signer);
        backendSigner = signer;
        emit BackendSignerUpdated(signer);
    }

    function _setOperator(address operatorAddress) internal {
        if (operatorAddress == address(0)) revert InvalidAddress(operatorAddress);
        operator = operatorAddress;
        emit OperatorUpdated(operatorAddress);
    }

    function _setRefundDelay(uint64 delay) internal {
        if (delay == 0) revert InvalidRefundDelay(delay);
        refundDelay = delay;
        emit RefundDelayUpdated(delay);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
