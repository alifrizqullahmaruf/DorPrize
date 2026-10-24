// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NativeGameVault} from "../src/NativeGameVault.sol";

contract NativeVaultFixture is Test {
    NativeGameVault internal vault;
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    bytes32 internal constant ROOM = keccak256("native-room");
    bytes32 internal constant RESULT = keccak256("persisted-server-result");
    address internal operator = makeAddr("operator");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal outsider = makeAddr("outsider");

    function setUp() public virtual {
        vault = new NativeGameVault(address(this), operator, vm.addr(SIGNER_KEY), treasury);
        _fund(alice, 20 ether);
        _fund(bob, 20 ether);
        _fund(carol, 20 ether);
    }

    function _fund(address player, uint256 amount) internal {
        vm.deal(player, amount);
        vm.prank(player);
        vault.deposit{value: amount}();
    }

    function _create(bytes32 id, uint256 bid, uint8 capacity) internal {
        vm.prank(operator);
        vault.createRoom(id, bid, capacity, uint64(block.timestamp + 10 minutes));
    }

    function _ticket(bytes32 id, address player, uint256 budget)
        internal
        view
        returns (NativeGameVault.JoinTicket memory)
    {
        return NativeGameVault.JoinTicket(id, player, budget, vault.nonces(player), uint64(block.timestamp + 5 minutes));
    }

    function _sign(NativeGameVault.JoinTicket memory ticket) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, vault.hashJoinTicket(ticket));
        return abi.encodePacked(r, s, v);
    }

    function _join(bytes32 id, address player, uint256 budget) internal {
        NativeGameVault.JoinTicket memory ticket = _ticket(id, player, budget);
        bytes memory sig = _sign(ticket);
        vm.prank(player);
        vault.joinRoom(ticket, sig);
    }

    function _start(bytes32 id) internal {
        bytes32 roster = vault.currentRosterHash(id);
        vm.prank(operator);
        vault.startRoom(id, roster);
    }

    function _game() internal {
        _create(ROOM, 1 ether, 6);
        _join(ROOM, alice, 2 ether);
        _join(ROOM, bob, 2 ether);
        _join(ROOM, carol, 2 ether);
        _start(ROOM);
    }

    function _settle(bytes32 id, address[] memory winners, uint256[] memory fees) internal {
        NativeGameVault.Room memory room = vault.getRoom(id);
        uint256 pot = room.bidWei * room.players.length;
        uint256 payout = winners.length == 1 ? pot : (pot / winners.length / 0.01 ether) * 0.01 ether;
        uint256[] memory amounts = new uint256[](winners.length);
        for (uint256 i; i < winners.length; i++) {
            amounts[i] = payout;
        }
        vm.prank(operator);
        vault.settleRoom(id, winners, amounts, fees, room.rosterHash, RESULT);
    }

    function _one(address winner) internal pure returns (address[] memory winners) {
        winners = new address[](1);
        winners[0] = winner;
    }

    function _solvent() internal view {
        assertEq(address(vault).balance, vault.totalLiabilities(), "native liabilities mismatch");
    }
}

contract NativeGameVaultTest is NativeVaultFixture {
    function test_DepositWithdrawNativeWithoutApproval() public {
        uint256 beforeBalance = alice.balance;
        vm.prank(alice);
        vault.withdraw(4 ether);
        assertEq(alice.balance, beforeBalance + 4 ether);
        assertEq(vault.availableBalanceOf(alice), 16 ether);
        _solvent();
    }

    function test_ZeroDepositWithdrawAndDirectTransferRejected() public {
        vm.expectRevert(NativeGameVault.ZeroAmount.selector);
        vault.deposit();
        vm.expectRevert(NativeGameVault.ZeroAmount.selector);
        vault.withdraw(0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        _solvent();
    }

    function test_JoinReservesBidAndSkillBudget() public {
        _create(ROOM, 1 ether, 6);
        _join(ROOM, alice, 2 ether);
        assertEq(vault.availableBalanceOf(alice), 17 ether);
        assertEq(vault.lockedBalanceOf(alice), 1 ether);
        assertEq(vault.skillReservedOf(alice), 2 ether);
        assertEq(vault.nonces(alice), 1);
        assertEq(vault.activeRoomOf(alice), ROOM);
        _solvent();
    }

    function test_WithdrawOnlyUnreservedBalanceWhileActive() public {
        _game();
        vm.prank(alice);
        vault.withdraw(17 ether);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InsufficientBalance.selector);
        vault.withdraw(1);
        uint256[] memory fees = new uint256[](3);
        fees[0] = 0.4 ether;
        _settle(ROOM, _one(bob), fees);
        assertEq(vault.availableBalanceOf(alice), 1.6 ether);
        assertEq(vault.totalTreasuryClaimable(), 0.4 ether);
        _solvent();
    }

    function test_LeaveReleasesWholeReserveAndDoesNotRecycleRoomId() public {
        _create(ROOM, 1 ether, 6);
        _join(ROOM, alice, 2 ether);
        vm.prank(alice);
        vault.leaveRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 20 ether);
        assertEq(vault.activeRoomOf(alice), bytes32(0));
        assertFalse(vault.getEntry(ROOM, alice).joined);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidRoom.selector);
        vault.createRoom(ROOM, 2 ether, 6, uint64(block.timestamp + 10 minutes));
        _solvent();
    }

    function test_LeaveThenRejoinRequiresNewNonce() public {
        _create(ROOM, 1 ether, 6);
        NativeGameVault.JoinTicket memory ticket = _ticket(ROOM, alice, 2 ether);
        bytes memory sig = _sign(ticket);
        vm.prank(alice);
        vault.joinRoom(ticket, sig);
        vm.prank(alice);
        vault.leaveRoom(ROOM);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
        _join(ROOM, alice, 2 ether);
        assertEq(vault.nonces(alice), 2);
        _solvent();
    }

    function test_RejectTicketForOtherWalletTamperedBudgetAndRoom() public {
        _create(ROOM, 1 ether, 6);
        bytes32 other = keccak256("other");
        _create(other, 1 ether, 6);
        NativeGameVault.JoinTicket memory ticket = _ticket(ROOM, alice, 2 ether);
        bytes memory sig = _sign(ticket);
        vm.prank(bob);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
        ticket.skillBudgetWei++;
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
        ticket.skillBudgetWei--;
        ticket.roomId = other;
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
    }

    function test_TicketCannotReplayAcrossChainOrVault() public {
        _create(ROOM, 1 ether, 6);
        NativeGameVault.JoinTicket memory ticket = _ticket(ROOM, alice, 2 ether);
        bytes memory sig = _sign(ticket);
        uint256 chain = vm.getChainId();
        vm.chainId(chain + 1);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
        vm.chainId(chain);

        NativeGameVault other = new NativeGameVault(address(this), operator, vm.addr(SIGNER_KEY), treasury);
        vm.prank(operator);
        other.createRoom(ROOM, 1 ether, 6, uint64(block.timestamp + 10 minutes));
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        other.joinRoom(ticket, sig);
    }

    function test_TicketExpiredWrongNonceWrongSignerAndMalformedSignature() public {
        _create(ROOM, 1 ether, 6);
        NativeGameVault.JoinTicket memory ticket = _ticket(ROOM, alice, 2 ether);
        ticket.deadline = uint64(block.timestamp - 1);
        bytes memory sig = _sign(ticket);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.DeadlineExpired.selector);
        vault.joinRoom(ticket, sig);

        ticket = _ticket(ROOM, alice, 2 ether);
        ticket.nonce = 1;
        sig = _sign(ticket);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, sig);
        ticket.nonce = 0;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, vault.hashJoinTicket(ticket));
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, abi.encodePacked(r, s, v));
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InvalidTicket.selector);
        vault.joinRoom(ticket, hex"1234");
    }

    function test_CannotJoinTwoRoomsOrExceedCapacity() public {
        _create(ROOM, 1 ether, 2);
        bytes32 other = keccak256("other");
        _create(other, 1 ether, 2);
        _join(ROOM, alice, 2 ether);
        NativeGameVault.JoinTicket memory ticket = _ticket(other, alice, 2 ether);
        bytes memory sig = _sign(ticket);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.PlayerAlreadyActive.selector);
        vault.joinRoom(ticket, sig);
        _join(ROOM, bob, 2 ether);
        ticket = _ticket(ROOM, carol, 2 ether);
        sig = _sign(ticket);
        vm.prank(carol);
        vm.expectRevert(NativeGameVault.RoomFull.selector);
        vault.joinRoom(ticket, sig);
    }

    function test_UnfundedBudgetRejectedWithoutConsumingNonce() public {
        _create(ROOM, 1 ether, 2);
        NativeGameVault.JoinTicket memory ticket = _ticket(ROOM, alice, 20 ether);
        bytes memory sig = _sign(ticket);
        vm.prank(alice);
        vm.expectRevert(NativeGameVault.InsufficientBalance.selector);
        vault.joinRoom(ticket, sig);
        assertEq(vault.nonces(alice), 0);
    }

    function test_StartRejectsChangedRosterAndInsufficientPlayers() public {
        _create(ROOM, 1 ether, 6);
        _join(ROOM, alice, 0);
        bytes32 roster = vault.currentRosterHash(ROOM);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.NotEnoughPlayers.selector);
        vault.startRoom(ROOM, roster);
        _join(ROOM, bob, 0);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.RosterMismatch.selector);
        vault.startRoom(ROOM, roster);
        _start(ROOM);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NativeGameVault.InvalidStatus.selector, NativeGameVault.Status.Active));
        vault.leaveRoom(ROOM);
    }

    function test_SingleWinnerReceivesWholePotFeesOnlyFromBudget() public {
        _game();
        uint256[] memory fees = new uint256[](3);
        fees[0] = 0.4 ether;
        fees[1] = 0.25 ether;
        _settle(ROOM, _one(alice), fees);
        assertEq(vault.availableBalanceOf(alice), 21.6 ether);
        assertEq(vault.availableBalanceOf(bob), 18.75 ether);
        assertEq(vault.availableBalanceOf(carol), 19 ether);
        assertEq(vault.totalTreasuryClaimable(), 0.65 ether);
        assertEq(vault.totalBidLocked(), 0);
        assertEq(vault.totalSkillReserved(), 0);
        assertEq(vault.activeRoomOf(alice), bytes32(0));
        assertEq(vault.getRoom(ROOM).resultHash, RESULT);
        _solvent();
    }

    function test_CustomBidSingleWinnerDoesNotLoseSubCentWei() public {
        _create(ROOM, 1 ether + 1, 2);
        _join(ROOM, alice, 0);
        _join(ROOM, bob, 0);
        _start(ROOM);
        _settle(ROOM, _one(alice), new uint256[](2));
        assertEq(vault.availableBalanceOf(alice), 21 ether + 1);
        assertEq(vault.totalRoomDust(), 0);
        _solvent();
    }

    function test_TieRoundsDownToCentAndKeepsDustOutOfTreasury() public {
        _create(ROOM, 1 ether + 1, 3);
        _join(ROOM, alice, 0);
        _join(ROOM, bob, 0);
        _join(ROOM, carol, 0);
        _start(ROOM);
        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = bob;
        _settle(ROOM, winners, new uint256[](3));
        assertEq(vault.availableBalanceOf(alice), 20.5 ether - 1);
        assertEq(vault.totalRoomDust(), 3);
        assertEq(vault.getRoom(ROOM).dustWei, 3);
        assertEq(vault.totalTreasuryClaimable(), 0);
        _solvent();
    }

    function test_TieTenMonThreeWinnersPaysThreePointThreeThree() public {
        // Four entrants at 2.5 MON => pot 10 MON, three winners => 0.01 MON dust.
        _fund(outsider, 20 ether);
        _create(ROOM, 2.5 ether, 4);
        _join(ROOM, alice, 0);
        _join(ROOM, bob, 0);
        _join(ROOM, carol, 0);
        _join(ROOM, outsider, 0);
        _start(ROOM);
        address[] memory winners = new address[](3);
        winners[0] = alice;
        winners[1] = bob;
        winners[2] = carol;
        _settle(ROOM, winners, new uint256[](4));
        assertEq(vault.availableBalanceOf(alice), 20.83 ether);
        assertEq(vault.totalRoomDust(), 0.01 ether);
        _solvent();
    }

    function test_SettlementRejectsUnauthorizedMismatchAndZeroResult() public {
        _game();
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 3 ether;
        uint256[] memory fees = new uint256[](3);
        bytes32 roster = vault.getRoom(ROOM).rosterHash;
        vm.prank(outsider);
        vm.expectRevert(NativeGameVault.UnauthorizedOperator.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, fees, roster, RESULT);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.RosterMismatch.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, fees, bytes32(0), RESULT);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSettlement.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, fees, roster, bytes32(0));
    }

    function test_SettlementRejectsDuplicateOrOutsiderRecipients() public {
        _game();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1.5 ether;
        amounts[1] = 1.5 ether;
        address[] memory winners = new address[](2);
        winners[0] = alice;
        winners[1] = alice;
        bytes32 roster = vault.getRoom(ROOM).rosterHash;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidRecipient.selector);
        vault.settleRoom(ROOM, winners, amounts, new uint256[](3), roster, RESULT);
        winners[1] = outsider;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidRecipient.selector);
        vault.settleRoom(ROOM, winners, amounts, new uint256[](3), roster, RESULT);
        _solvent();
    }

    function test_OverpaidUnequalAndMalformedSettlementRejected() public {
        _game();
        bytes32 roster = vault.getRoom(ROOM).rosterHash;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 3 ether + 1;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSettlement.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, new uint256[](3), roster, RESULT);
        amounts[0] = 3 ether;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSettlement.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, new uint256[](2), roster, RESULT);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSettlement.selector);
        vault.settleRoom(ROOM, new address[](0), new uint256[](0), new uint256[](3), roster, RESULT);
    }

    function test_ExcessOrSubCentSkillFeeRevertsWholeSettlement() public {
        _game();
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 3 ether;
        uint256[] memory fees = new uint256[](3);
        fees[1] = 2.01 ether;
        bytes32 roster = vault.getRoom(ROOM).rosterHash;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSkillFee.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, fees, roster, RESULT);
        assertEq(uint8(vault.getRoom(ROOM).status), uint8(NativeGameVault.Status.Active));
        assertEq(vault.totalSkillReserved(), 6 ether);
        assertEq(vault.totalBidLocked(), 3 ether);
        fees[1] = 1;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.InvalidSkillFee.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, fees, roster, RESULT);
        _solvent();
    }

    function test_DoubleSettlementAndRefundAfterSettleRejected() public {
        _game();
        _settle(ROOM, _one(alice), new uint256[](3));
        bytes32 roster = vault.getRoom(ROOM).rosterHash;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(NativeGameVault.InvalidStatus.selector, NativeGameVault.Status.Settled));
        vault.settleRoom(ROOM, _one(alice), new uint256[](1), new uint256[](3), roster, RESULT);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(NativeGameVault.InvalidStatus.selector, NativeGameVault.Status.Settled));
        vault.refundExpiredRoom(ROOM);
        _solvent();
    }

    function test_ExactExpiryRefundWinsAndSettlementIsClosed() public {
        _game();
        NativeGameVault.Room memory room = vault.getRoom(ROOM);
        vm.expectRevert(NativeGameVault.RefundNotAvailable.selector);
        vault.refundExpiredRoom(ROOM);
        vm.warp(room.settlementDeadline);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 3 ether;
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.DeadlineExpired.selector);
        vault.settleRoom(ROOM, _one(alice), amounts, new uint256[](3), room.rosterHash, RESULT);
        vm.prank(outsider);
        vault.refundExpiredRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 20 ether);
        assertEq(vault.totalTreasuryClaimable(), 0);
        assertEq(vault.totalBidLocked(), 0);
        assertEq(vault.totalSkillReserved(), 0);
        vm.expectRevert(
            abi.encodeWithSelector(NativeGameVault.InvalidStatus.selector, NativeGameVault.Status.Cancelled)
        );
        vault.refundExpiredRoom(ROOM);
        _solvent();
    }

    function test_SettlementImmediatelyBeforeExpirySucceeds() public {
        _game();
        vm.warp(vault.getRoom(ROOM).settlementDeadline - 1);
        _settle(ROOM, _one(alice), new uint256[](3));
        _solvent();
    }

    function test_WaitingCancelOperatorOrAnyoneAfterDeadline() public {
        _create(ROOM, 1 ether, 6);
        _join(ROOM, alice, 2 ether);
        vm.prank(outsider);
        vm.expectRevert(NativeGameVault.RefundNotAvailable.selector);
        vault.cancelWaitingRoom(ROOM);
        vm.warp(vault.getRoom(ROOM).joinDeadline);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.DeadlineExpired.selector);
        vault.startRoom(ROOM, bytes32(0));
        vm.prank(outsider);
        vault.cancelWaitingRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 20 ether);
        _solvent();
    }

    function test_PauseNeverBlocksExitRecoveryOrAvailableWithdrawals() public {
        _game();
        vault.pause();
        vm.prank(alice);
        vault.withdraw(1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.deposit{value: 1}();
        vm.warp(vault.getRoom(ROOM).settlementDeadline);
        vault.refundExpiredRoom(ROOM);
        assertEq(vault.availableBalanceOf(alice), 19 ether);
        _solvent();
    }

    function test_TreasuryCannotWithdrawUserFundsOrDust() public {
        _game();
        uint256[] memory fees = new uint256[](3);
        fees[0] = 0.15 ether;
        _settle(ROOM, _one(alice), fees);
        vm.prank(operator);
        vm.expectRevert(NativeGameVault.UnauthorizedTreasury.selector);
        vault.withdrawTreasury(0.15 ether);
        vm.prank(treasury);
        vm.expectRevert(NativeGameVault.InsufficientBalance.selector);
        vault.withdrawTreasury(0.15 ether + 1);
        vm.prank(treasury);
        vault.withdrawTreasury(0.15 ether);
        assertEq(treasury.balance, 0.15 ether);
        _solvent();
    }

    function test_FailedNativeTransferRollsBackAccounting() public {
        RejectingReceiver receiver = new RejectingReceiver(vault);
        _fund(address(receiver), 2 ether);
        vm.expectRevert(NativeGameVault.TransferFailed.selector);
        receiver.withdraw();
        assertEq(vault.availableBalanceOf(address(receiver)), 2 ether);
        _solvent();
    }

    function test_ReentrantWithdrawalCannotSpendTwice() public {
        ReentrantReceiver receiver = new ReentrantReceiver(vault);
        _fund(address(receiver), 2 ether);
        receiver.withdraw();
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentered());
        assertEq(vault.availableBalanceOf(address(receiver)), 0);
        assertEq(address(receiver).balance, 2 ether);
        _solvent();
    }

    function test_AdminRotationAndTwoStepOwnership() public {
        vm.prank(outsider);
        vm.expectRevert();
        vault.setOperator(outsider);
        vm.prank(outsider);
        vm.expectRevert();
        vault.setBackendSigner(outsider);
        vault.transferOwnership(alice);
        assertEq(vault.owner(), address(this));
        vm.prank(alice);
        vault.acceptOwnership();
        vm.prank(alice);
        vault.setOperator(bob);
        assertEq(vault.operator(), bob);
    }

    function test_SeparateRoomsCannotConsumeEachOthersEscrow() public {
        _game();
        bytes32 other = keccak256("parallel-room");
        address dave = makeAddr("dave");
        address eve = makeAddr("eve");
        _fund(dave, 10 ether);
        _fund(eve, 10 ether);
        _create(other, 5 ether, 2);
        _join(other, dave, 1 ether);
        _join(other, eve, 1 ether);
        _start(other);
        _settle(ROOM, _one(alice), new uint256[](3));
        assertEq(vault.totalBidLocked(), 10 ether);
        assertEq(vault.totalSkillReserved(), 2 ether);
        _settle(other, _one(eve), new uint256[](2));
        assertEq(vault.availableBalanceOf(eve), 15 ether);
        _solvent();
    }

    function testFuzz_SettlementConservesAllNativeLiabilities(
        uint96 rawBid,
        uint96 rawBudget,
        uint8 count,
        uint96 rawFee
    ) public {
        uint256 bid = bound(rawBid, 1 ether, 5 ether);
        uint256 budget = bound(rawBudget, 0, 10 ether);
        uint256 fee = (bound(rawFee, 0, budget) / 0.01 ether) * 0.01 ether;
        count = uint8(bound(count, 1, 3));
        _create(ROOM, bid, 3);
        _join(ROOM, alice, budget);
        _join(ROOM, bob, budget);
        _join(ROOM, carol, budget);
        _start(ROOM);
        address[3] memory all = [alice, bob, carol];
        address[] memory winners = new address[](count);
        for (uint256 i; i < count; i++) {
            winners[i] = all[i];
        }
        uint256[] memory fees = new uint256[](3);
        fees[0] = fee;
        _settle(ROOM, winners, fees);
        assertEq(vault.totalTreasuryClaimable(), fee);
        assertEq(vault.totalBidLocked(), 0);
        assertEq(vault.totalSkillReserved(), 0);
        uint256 pot = bid * 3;
        uint256 payout = count == 1 ? pot : (pot / count / 0.01 ether) * 0.01 ether;
        assertEq(payout * count + vault.totalRoomDust(), pot);
        _solvent();
    }
}

contract RejectingReceiver {
    NativeGameVault private immutable vault;

    constructor(NativeGameVault vault_) {
        vault = vault_;
    }

    function withdraw() external {
        vault.withdraw(1 ether);
    }

    receive() external payable {
        revert("reject");
    }
}

contract ReentrantReceiver {
    NativeGameVault private immutable vault;
    bool public attempted;
    bool public reentered;

    constructor(NativeGameVault vault_) {
        vault = vault_;
    }

    function withdraw() external {
        vault.withdraw(2 ether);
    }

    receive() external payable {
        attempted = true;
        (reentered,) = address(vault).call(abi.encodeCall(vault.withdraw, (1 ether)));
    }
}
