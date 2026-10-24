// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Fixture} from "./Fixture.sol";
import {RoomManager} from "../src/RoomManager.sol";

contract RoomManagerTest is Fixture {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");
    bytes32 internal constant ROOM = keccak256("ROOM1");
    uint256 internal constant BID = 1 * USDC;

    function setUp() public override {
        super.setUp();
        _fund(alice, 10 * USDC);
        _fund(bob, 10 * USDC);
        _fund(carol, 10 * USDC);
    }

    function _threePlayerGame() internal {
        _join(alice, ROOM, BID, 4);
        _join(bob, ROOM, BID, 4);
        _join(carol, ROOM, BID, 4);
        vm.prank(operator);
        rooms.startRoom(ROOM);
    }

    function _noFees() internal pure returns (uint256[] memory fees) {
        fees = new uint256[](3);
    }

    // ------------------------------------------------------------ join / leave

    function test_JoinLocksBidAndCreatesRoom() public {
        _join(alice, ROOM, BID, 4);
        (uint256 bid, uint8 maxPlayers, RoomManager.Status status,,, address[] memory players) = rooms.getRoom(ROOM);
        assertEq(bid, BID);
        assertEq(maxPlayers, 4);
        assertEq(uint8(status), uint8(RoomManager.Status.Open));
        assertEq(players.length, 1);
        assertEq(vault.lockedBalanceOf(alice), BID);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC - BID);
        assertEq(vault.activeRoomsOf(alice), 1);
    }

    function test_JoinRejectsTicketNotSignedByBackend() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, rooms.hashJoinTicket(ROOM, alice, BID, 4, deadline));
        vm.prank(alice);
        vm.expectRevert();
        rooms.joinRoom(ROOM, BID, 4, deadline, abi.encodePacked(r, s, v));
    }

    function test_JoinRejectsTicketForAnotherPlayer() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory aliceTicket = _sign(rooms.hashJoinTicket(ROOM, alice, BID, 4, deadline));
        vm.prank(mallory);
        vm.expectRevert();
        rooms.joinRoom(ROOM, BID, 4, deadline, aliceTicket);
    }

    function test_JoinRejectsExpiredTicket() public {
        uint64 deadline = uint64(block.timestamp + 1 minutes);
        bytes memory sig = _sign(rooms.hashJoinTicket(ROOM, alice, BID, 4, deadline));
        vm.warp(block.timestamp + 2 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.TicketExpired.selector, deadline));
        rooms.joinRoom(ROOM, BID, 4, deadline, sig);
    }

    function test_JoinRejectsDifferentTermsAndBadParams() public {
        _join(alice, ROOM, BID, 4);
        _joinExpect(bob, ROOM, 2 * BID, 4, abi.encodeWithSelector(RoomManager.RoomTermsMismatch.selector, BID, 4));

        bytes32 other = keccak256("ROOM2");
        _joinExpect(bob, other, BID - 1, 4, abi.encodeWithSelector(RoomManager.InvalidBid.selector, BID - 1));
        _joinExpect(bob, other, BID, 11, abi.encodeWithSelector(RoomManager.InvalidMaxPlayers.selector, 11));
    }

    function test_JoinRejectsDoubleJoinAndFullRoom() public {
        _join(alice, ROOM, BID, 2);
        _joinExpect(alice, ROOM, BID, 2, abi.encodeWithSelector(RoomManager.AlreadyInRoom.selector, ROOM, alice));
        _join(bob, ROOM, BID, 2);
        _joinExpect(carol, ROOM, BID, 2, abi.encodeWithSelector(RoomManager.RoomFull.selector, ROOM));
    }

    function test_LeaveBeforeStartReturnsBid() public {
        _join(alice, ROOM, BID, 4);
        _join(bob, ROOM, BID, 4);
        vm.prank(alice);
        rooms.leaveRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC);
        assertEq(vault.activeRoomsOf(alice), 0);
        assertFalse(rooms.isInRoom(ROOM, alice));
        _assertSolvent();
    }

    function test_LastPlayerLeavingResetsRoom() public {
        _join(alice, ROOM, BID, 4);
        vm.prank(alice);
        rooms.leaveRoom(ROOM);
        (,, RoomManager.Status status,,,) = rooms.getRoom(ROOM);
        assertEq(uint8(status), uint8(RoomManager.Status.None));
        // The id can be reused with new terms.
        _join(bob, ROOM, 2 * BID, 3);
    }

    function test_CannotLeaveAfterStart() public {
        _threePlayerGame();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.RoomNotOpen.selector, ROOM, RoomManager.Status.Started));
        rooms.leaveRoom(ROOM);
    }

    // ------------------------------------------------------------ start

    function test_OnlyOperatorStartsWithTwoPlayers() public {
        _join(alice, ROOM, BID, 4);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.UnauthorizedOperator.selector, alice));
        rooms.startRoom(ROOM);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.NotEnoughPlayers.selector, 1));
        rooms.startRoom(ROOM);

        _join(bob, ROOM, BID, 4);
        vm.prank(operator);
        rooms.startRoom(ROOM);
        _joinExpect(
            carol,
            ROOM,
            BID,
            4,
            abi.encodeWithSelector(RoomManager.RoomNotOpen.selector, ROOM, RoomManager.Status.Started)
        );
    }

    // ------------------------------------------------------------ settle

    function test_SettleSingleWinnerTakesPot() public {
        _threePlayerGame();
        // Anyone may submit a backend-signed settlement.
        _settleExpect(mallory, ROOM, _addrs(bob), _noFees(), "");

        assertEq(vault.availableBalanceOf(bob), 10 * USDC - BID + 3 * BID);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC - BID);
        assertEq(vault.lockedBalanceOf(alice), 0);
        assertEq(vault.activeRoomsOf(alice), 0);
        assertEq(vault.activeRoomsOf(bob), 0);
        _assertSolvent();

        // Winner can withdraw again.
        vm.prank(bob);
        vault.withdraw(12 * USDC);
    }

    function test_SettleSplitsPotAndSendsDustToTreasury() public {
        _threePlayerGame();
        _settle(ROOM, _addrs(alice, carol), _noFees());
        // 3 USDC split 2 ways = 1.5 USDC each, no dust at 6 decimals.
        assertEq(vault.availableBalanceOf(alice), 10 * USDC - BID + 1_500_000);
        assertEq(vault.availableBalanceOf(carol), 10 * USDC - BID + 1_500_000);
        assertEq(vault.treasuryBalance(), 0);
        _assertSolvent();
    }

    function test_SettleDustGoesToTreasury() public {
        bytes32 room2 = keccak256("ODD");
        uint256 bid = 1_000_001;
        _join(alice, room2, bid, 3);
        _join(bob, room2, bid, 3);
        _join(carol, room2, bid, 3);
        vm.prank(operator);
        rooms.startRoom(room2);
        address[] memory winners = new address[](3);
        winners[0] = alice;
        winners[1] = bob;
        winners[2] = carol;
        _settle(room2, winners, _noFees());
        assertEq(vault.treasuryBalance(), 0); // 3 * 1_000_001 / 3 splits exactly
        _assertSolvent();

        bytes32 room3 = keccak256("ODD2");
        _join(alice, room3, bid, 3);
        _join(bob, room3, bid, 3);
        _join(carol, room3, bid, 3);
        vm.prank(operator);
        rooms.startRoom(room3);
        _settle(room3, _addrs(alice, bob), _noFees()); // 3_000_003 / 2 -> 1 unit of dust
        assertEq(vault.treasuryBalance(), 1);
        _assertSolvent();
    }

    function test_SettleChargesSkillFeesToTreasury() public {
        _threePlayerGame();
        uint256[] memory fees = new uint256[](3);
        fees[0] = 400_000; // alice: gold helm (40%)
        fees[1] = 250_000; // bob: shotgun (25%)
        _settle(ROOM, _addrs(alice), fees);

        assertEq(vault.availableBalanceOf(alice), 10 * USDC - BID + 3 * BID - 400_000);
        assertEq(vault.availableBalanceOf(bob), 10 * USDC - BID - 250_000);
        assertEq(vault.treasuryBalance(), 650_000);
        _assertSolvent();
    }

    function test_SkillFeeIsCappedAtAvailableBalance() public {
        address poor = makeAddr("poor");
        _fund(poor, 1 * USDC);
        _join(alice, ROOM, BID, 2);
        _join(poor, ROOM, BID, 2);
        vm.prank(operator);
        rooms.startRoom(ROOM);
        uint256[] memory fees = new uint256[](2);
        fees[1] = 5 * USDC; // more than the 0 USDC poor has left
        _settle(ROOM, _addrs(alice), fees);
        assertEq(vault.availableBalanceOf(poor), 0);
        assertEq(vault.treasuryBalance(), 0);
        _assertSolvent();
    }

    function test_SettleOnlyOnce() public {
        _threePlayerGame();
        _settle(ROOM, _addrs(bob), _noFees());
        _settleExpect(
            mallory,
            ROOM,
            _addrs(bob),
            _noFees(),
            // The settled room is closed; its id now points at a fresh, empty generation.
            abi.encodeWithSelector(RoomManager.RoomNotStarted.selector, ROOM, RoomManager.Status.None)
        );
    }

    function test_SettleRejectsTamperedWinners() public {
        _threePlayerGame();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        uint256[] memory fees = _noFees();
        bytes memory sig = _sign(rooms.hashSettlement(ROOM, _addrs(bob), fees, deadline));
        vm.expectRevert();
        rooms.settleRoom(ROOM, _addrs(carol), fees, deadline, sig);
    }

    function test_SettleRejectsOutsiderOrDuplicateWinners() public {
        _threePlayerGame();
        bytes memory err = abi.encodeWithSelector(RoomManager.InvalidWinners.selector);
        _settleExpect(mallory, ROOM, _addrs(mallory), _noFees(), err);
        _settleExpect(mallory, ROOM, _addrs(bob, bob), _noFees(), err);
    }

    function test_SettleRequiresStartedRoom() public {
        _join(alice, ROOM, BID, 4);
        _join(bob, ROOM, BID, 4);
        uint256[] memory fees = new uint256[](2);
        _settleExpect(
            mallory,
            ROOM,
            _addrs(bob),
            fees,
            abi.encodeWithSelector(RoomManager.RoomNotStarted.selector, ROOM, RoomManager.Status.Open)
        );
    }

    // ------------------------------------------------------------ refund

    function test_RefundOnlyAfterDelay() public {
        _threePlayerGame();
        (,,, uint64 createdAt,,) = rooms.getRoom(ROOM);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.RefundNotAvailable.selector, createdAt + 1 hours));
        rooms.refundRoom(ROOM);

        vm.warp(createdAt + 1 hours);
        vm.prank(mallory);
        rooms.refundRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC);
        assertEq(vault.availableBalanceOf(bob), 10 * USDC);
        assertEq(vault.activeRoomsOf(carol), 0);
        _assertSolvent();

        vm.expectRevert(abi.encodeWithSelector(RoomManager.RoomAlreadyClosed.selector, ROOM, RoomManager.Status.None));
        rooms.refundRoom(ROOM);
    }

    function test_CannotRefundSettledRoom() public {
        _threePlayerGame();
        _settle(ROOM, _addrs(bob), _noFees());
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(RoomManager.RoomAlreadyClosed.selector, ROOM, RoomManager.Status.None));
        rooms.refundRoom(ROOM);
    }

    function test_RefundOfStartedRoomCountsFromStart() public {
        _join(alice, ROOM, BID, 4);
        _join(bob, ROOM, BID, 4);
        // The lobby waits longer than the refund delay before the game starts.
        vm.warp(block.timestamp + 2 hours);
        vm.prank(operator);
        rooms.startRoom(ROOM);
        (,,,, uint64 startedAt,) = rooms.getRoom(ROOM);

        vm.expectRevert(abi.encodeWithSelector(RoomManager.RefundNotAvailable.selector, startedAt + 1 hours));
        rooms.refundRoom(ROOM);

        vm.warp(startedAt + 1 hours);
        rooms.refundRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC);
        _assertSolvent();
    }

    function test_SettledRoomIdCanBeReused() public {
        _threePlayerGame();
        _settle(ROOM, _addrs(bob), _noFees());
        assertFalse(rooms.isInRoom(ROOM, alice));

        // Same code, new terms: a brand-new room.
        _join(alice, ROOM, 2 * BID, 2);
        (uint256 bid, uint8 maxPlayers, RoomManager.Status status,,, address[] memory players) = rooms.getRoom(ROOM);
        assertEq(bid, 2 * BID);
        assertEq(maxPlayers, 2);
        assertEq(uint8(status), uint8(RoomManager.Status.Open));
        assertEq(players.length, 1);
        assertTrue(rooms.isInRoom(ROOM, alice));
        assertFalse(rooms.isInRoom(ROOM, bob));
        _assertSolvent();
    }

    function test_RefundedRoomIdCanBeReused() public {
        _threePlayerGame();
        vm.warp(block.timestamp + 1 hours);
        rooms.refundRoom(ROOM);
        _join(carol, ROOM, BID, 3);
        (,, RoomManager.Status status,,, address[] memory players) = rooms.getRoom(ROOM);
        assertEq(uint8(status), uint8(RoomManager.Status.Open));
        assertEq(players.length, 1);
        _assertSolvent();
    }

    // ------------------------------------------------------------ admin

    function test_AdminSettersAreOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        rooms.setBackendSigner(alice);

        vm.prank(owner);
        rooms.setRefundDelay(30 minutes);
        assertEq(rooms.refundDelay(), 30 minutes);
    }

    function test_PausedBlocksJoinButNotRefund() public {
        _threePlayerGame();
        vm.prank(owner);
        rooms.pause();
        _fund(mallory, 10 * USDC);
        _joinExpect(mallory, keccak256("X"), BID, 4, abi.encodeWithSignature("EnforcedPause()"));
        vm.warp(block.timestamp + 1 hours);
        rooms.refundRoom(ROOM);
        _assertSolvent();
    }

    // ------------------------------------------------------------ fuzz

    /// @dev Whatever the bids and number of winners, the vault stays exactly solvent.
    function testFuzz_SettlementKeepsVaultSolvent(uint256 bid, uint8 winnerCount, uint256 feeA) public {
        bid = bound(bid, 1 * USDC, 3 * USDC);
        winnerCount = uint8(bound(winnerCount, 1, 3));
        feeA = bound(feeA, 0, 20 * USDC);
        _join(alice, ROOM, bid, 3);
        _join(bob, ROOM, bid, 3);
        _join(carol, ROOM, bid, 3);
        vm.prank(operator);
        rooms.startRoom(ROOM);

        address[] memory winners = new address[](winnerCount);
        address[3] memory all = [alice, bob, carol];
        for (uint256 i = 0; i < winnerCount; i++) {
            winners[i] = all[i];
        }
        uint256[] memory fees = new uint256[](3);
        fees[0] = feeA;
        _settle(ROOM, winners, fees);
        _assertSolvent();
        assertEq(vault.totalLockedBalance(), 0);
    }
}
