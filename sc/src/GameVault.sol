// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title GameVault
/// @notice Holds player USDC for DOR PRIZE. Balances are either `available` (free to withdraw or bid)
///         or `locked` (bid committed to a room). Skill fees and split-pot dust go to the treasury.
/// @dev Adapted from PassChick's GameVault. Only the RoomManager can move balances between
///      buckets, and players cannot withdraw while they are in an active room.
contract GameVault is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InvalidRoomManager(address roomManager);
    error RoomManagerNotSet();
    error UnauthorizedRoomManager(address account);
    error ZeroAmount();
    error NoWinners();
    error InsufficientAvailableBalance(uint256 available, uint256 requested);
    error InsufficientLockedBalance(uint256 locked, uint256 requested);
    error InsufficientTreasury(uint256 available, uint256 requested);
    error InsufficientRescuableBalance(uint256 available, uint256 requested);
    error WithdrawBlockedActiveRoom(address account, uint256 activeRooms);

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event TreasuryWithdrawn(address indexed recipient, uint256 amount);
    event TokenRescued(address indexed token, address indexed recipient, uint256 amount);
    event RoomManagerUpdated(address indexed roomManager);
    event BidLocked(address indexed player, bytes32 indexed roomId, uint256 amount);
    event BidUnlocked(address indexed player, bytes32 indexed roomId, uint256 amount);
    event PotPaid(address indexed winner, bytes32 indexed roomId, uint256 amount);
    event PotDust(bytes32 indexed roomId, uint256 amount);
    event SkillFeeCharged(address indexed player, bytes32 indexed roomId, uint256 requested, uint256 charged);

    IERC20 public usdc;
    address public roomManager;
    uint256 public treasuryBalance;
    uint256 public totalAvailableBalance;
    uint256 public totalLockedBalance;

    mapping(address account => uint256 balance) private availableBalances;
    mapping(address account => uint256 balance) private lockedBalances;
    mapping(address account => uint256 rooms) private activeRooms;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyRoomManager() {
        _onlyRoomManager();
        _;
    }

    function initialize(address initialOwner, address usdcAddress) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        if (usdcAddress == address(0)) revert InvalidToken(usdcAddress);
        usdc = IERC20(usdcAddress);
    }

    // ---------------------------------------------------------------- admin

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setRoomManager(address roomManagerAddress) external onlyOwner {
        if (roomManagerAddress == address(0)) revert InvalidRoomManager(roomManagerAddress);
        roomManager = roomManagerAddress;
        emit RoomManagerUpdated(roomManagerAddress);
    }

    function treasuryWithdraw(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (amount == 0) revert ZeroAmount();
        if (amount > treasuryBalance) revert InsufficientTreasury(treasuryBalance, amount);
        treasuryBalance -= amount;
        usdc.safeTransfer(recipient, amount);
        emit TreasuryWithdrawn(recipient, amount);
    }

    /// @notice Recover tokens sent here by mistake. Never touches funds owed to players or the treasury.
    function rescueToken(address tokenAddress, address recipient, uint256 amount) external onlyOwner {
        if (tokenAddress == address(0)) revert InvalidToken(tokenAddress);
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (amount == 0) revert ZeroAmount();

        IERC20 tokenToRescue = IERC20(tokenAddress);
        if (tokenAddress == address(usdc)) {
            uint256 reserved = totalAvailableBalance + totalLockedBalance + treasuryBalance;
            uint256 actual = tokenToRescue.balanceOf(address(this));
            uint256 rescuable = actual > reserved ? actual - reserved : 0;
            if (amount > rescuable) revert InsufficientRescuableBalance(rescuable, amount);
        }
        tokenToRescue.safeTransfer(recipient, amount);
        emit TokenRescued(tokenAddress, recipient, amount);
    }

    // ---------------------------------------------------------------- players

    function deposit(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        availableBalances[msg.sender] += amount;
        totalAvailableBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw available balance. Blocked while the caller is in an active room.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 rooms = activeRooms[msg.sender];
        if (rooms > 0) revert WithdrawBlockedActiveRoom(msg.sender, rooms);
        uint256 current = availableBalances[msg.sender];
        if (amount > current) revert InsufficientAvailableBalance(current, amount);

        availableBalances[msg.sender] = current - amount;
        totalAvailableBalance -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function fundTreasury(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        treasuryBalance += amount;
        emit TreasuryFunded(msg.sender, amount);
    }

    // ---------------------------------------------------------------- room manager

    /// @notice Move `amount` from available to locked and mark the player as in a room.
    function lockBid(address player, bytes32 roomId, uint256 amount) external onlyRoomManager whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        uint256 current = availableBalances[player];
        if (amount > current) revert InsufficientAvailableBalance(current, amount);

        availableBalances[player] = current - amount;
        totalAvailableBalance -= amount;
        lockedBalances[player] += amount;
        totalLockedBalance += amount;
        activeRooms[player] += 1;
        emit BidLocked(player, roomId, amount);
    }

    /// @notice Return a locked bid (left before start, or refunded room).
    function unlockBid(address player, bytes32 roomId, uint256 amount) external onlyRoomManager {
        _consumeLocked(player, amount);
        availableBalances[player] += amount;
        totalAvailableBalance += amount;
        emit BidUnlocked(player, roomId, amount);
    }

    /// @notice Settle a room's pot: every player's bid is consumed and the pot is split evenly
    ///         between `winners`. Integer-division dust goes to the treasury.
    /// @return payoutEach Amount credited to each winner.
    function settlePot(bytes32 roomId, address[] calldata players, uint256 bid, address[] calldata winners)
        external
        onlyRoomManager
        returns (uint256 payoutEach)
    {
        if (winners.length == 0) revert NoWinners();
        for (uint256 i = 0; i < players.length; i++) {
            _consumeLocked(players[i], bid);
        }

        uint256 pot = bid * players.length;
        payoutEach = pot / winners.length;
        uint256 dust = pot - payoutEach * winners.length;

        for (uint256 i = 0; i < winners.length; i++) {
            availableBalances[winners[i]] += payoutEach;
            emit PotPaid(winners[i], roomId, payoutEach);
        }
        totalAvailableBalance += payoutEach * winners.length;
        if (dust > 0) {
            treasuryBalance += dust;
            emit PotDust(roomId, dust);
        }
    }

    /// @notice Charge a skill fee from the player's available balance into the treasury.
    /// @dev Charges at most what is available so a settlement can never get stuck.
    /// @return charged Amount actually moved to the treasury.
    function chargeSkillFee(address player, bytes32 roomId, uint256 amount)
        external
        onlyRoomManager
        returns (uint256 charged)
    {
        uint256 current = availableBalances[player];
        charged = amount < current ? amount : current;
        if (charged > 0) {
            availableBalances[player] = current - charged;
            totalAvailableBalance -= charged;
            treasuryBalance += charged;
        }
        emit SkillFeeCharged(player, roomId, amount, charged);
    }

    // ---------------------------------------------------------------- views

    function availableBalanceOf(address account) external view returns (uint256) {
        return availableBalances[account];
    }

    function lockedBalanceOf(address account) external view returns (uint256) {
        return lockedBalances[account];
    }

    function activeRoomsOf(address account) external view returns (uint256) {
        return activeRooms[account];
    }

    // ---------------------------------------------------------------- internal

    function _consumeLocked(address player, uint256 amount) internal {
        uint256 current = lockedBalances[player];
        if (amount > current) revert InsufficientLockedBalance(current, amount);
        lockedBalances[player] = current - amount;
        totalLockedBalance -= amount;
        if (activeRooms[player] > 0) activeRooms[player] -= 1;
    }

    function _onlyRoomManager() internal view {
        if (roomManager == address(0)) revert RoomManagerNotSet();
        if (msg.sender != roomManager) revert UnauthorizedRoomManager(msg.sender);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
