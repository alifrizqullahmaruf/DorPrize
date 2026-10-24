// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NativeGameVault} from "../src/NativeGameVault.sol";

/// @dev Interleaves real lifecycle operations and signs real EIP-712 tickets; no direct storage writes.
contract NativeVaultHandler is Test {
    NativeGameVault public immutable vault;
    uint256 private constant KEY = 0xBACC;
    address[3] public actors;
    bytes32 public roomId;
    uint256 public roomNumber;

    constructor(NativeGameVault vault_) {
        vault = vault_;
        actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    }

    function newRoom(uint96 rawBid) public {
        NativeGameVault.Room memory old = vault.getRoom(roomId);
        if (old.status == NativeGameVault.Status.Active) return;
        if (old.status == NativeGameVault.Status.Waiting) vault.cancelWaitingRoom(roomId);
        roomId = bytes32(++roomNumber);
        vault.createRoom(roomId, bound(rawBid, 1 ether, 5 ether), 3, uint64(block.timestamp + 10 minutes));
    }

    function deposit(uint8 actorIndex, uint96 amount) public {
        address actor = actors[actorIndex % 3];
        uint256 value = bound(amount, 1, 20 ether);
        vm.deal(actor, actor.balance + value);
        vm.prank(actor);
        vault.deposit{value: value}();
    }

    function join(uint8 actorIndex, uint96 rawBudget) public {
        NativeGameVault.Room memory room = vault.getRoom(roomId);
        address actor = actors[actorIndex % 3];
        if (
            room.status != NativeGameVault.Status.Waiting || block.timestamp >= room.joinDeadline
                || vault.activeRoomOf(actor) != bytes32(0) || room.players.length == 3
        ) return;
        uint256 balance = vault.availableBalanceOf(actor);
        if (balance < room.bidWei) return;
        uint256 budget = bound(rawBudget, 0, balance - room.bidWei);
        NativeGameVault.JoinTicket memory ticket =
            NativeGameVault.JoinTicket(roomId, actor, budget, vault.nonces(actor), uint64(block.timestamp + 5 minutes));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, vault.hashJoinTicket(ticket));
        vm.prank(actor);
        vault.joinRoom(ticket, abi.encodePacked(r, s, v));
    }

    function leave(uint8 actorIndex) public {
        address actor = actors[actorIndex % 3];
        if (
            vault.getRoom(roomId).status != NativeGameVault.Status.Waiting || vault.activeRoomOf(actor) != roomId
                || roomId == bytes32(0)
        ) return;
        vm.prank(actor);
        vault.leaveRoom(roomId);
    }

    function start() public {
        NativeGameVault.Room memory room = vault.getRoom(roomId);
        if (
            room.status != NativeGameVault.Status.Waiting || room.players.length < 2
                || block.timestamp >= room.joinDeadline
        ) return;
        vault.startRoom(roomId, vault.currentRosterHash(roomId));
    }

    function settle(uint8 rawCount, uint96 rawFee) public {
        NativeGameVault.Room memory room = vault.getRoom(roomId);
        if (room.status != NativeGameVault.Status.Active || block.timestamp >= room.settlementDeadline) return;
        uint256 count = bound(rawCount, 1, room.players.length);
        uint256 pot = room.bidWei * room.players.length;
        uint256 payout = count == 1 ? pot : (pot / count / 0.01 ether) * 0.01 ether;
        address[] memory recipients = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256[] memory fees = new uint256[](room.players.length);
        for (uint256 i; i < count; i++) {
            recipients[i] = room.players[i];
            amounts[i] = payout;
        }
        for (uint256 i; i < room.players.length; i++) {
            uint256 budget = vault.getEntry(roomId, room.players[i]).skillBudgetWei;
            fees[i] = (bound(rawFee, 0, budget) / 0.01 ether) * 0.01 ether;
        }
        vault.settleRoom(roomId, recipients, amounts, fees, room.rosterHash, keccak256("server-result"));
    }

    function expireAndRefund() public {
        NativeGameVault.Room memory room = vault.getRoom(roomId);
        if (room.status == NativeGameVault.Status.Active) {
            vm.warp(room.settlementDeadline);
            vault.refundExpiredRoom(roomId);
        } else if (room.status == NativeGameVault.Status.Waiting) {
            vm.warp(room.joinDeadline);
            vault.cancelWaitingRoom(roomId);
        }
    }

    function withdraw(uint8 actorIndex, uint96 rawAmount) public {
        address actor = actors[actorIndex % 3];
        uint256 balance = vault.availableBalanceOf(actor);
        if (balance == 0) return;
        vm.prank(actor);
        vault.withdraw(bound(rawAmount, 1, balance));
    }

    function withdrawTreasury(uint96 rawAmount) public {
        uint256 balance = vault.totalTreasuryClaimable();
        if (balance == 0) return;
        vm.prank(vault.treasury());
        vault.withdrawTreasury(bound(rawAmount, 1, balance));
    }
}

contract NativeGameVaultInvariantTest is Test {
    NativeGameVault private vault;
    NativeVaultHandler private handler;

    function setUp() public {
        vault = new NativeGameVault(address(this), address(this), vm.addr(0xBACC), address(0x711EA5));
        handler = new NativeVaultHandler(vault);
        vault.setOperator(address(handler));
        handler.newRoom(1 ether);
        for (uint8 i; i < 3; i++) {
            handler.deposit(i, 20 ether);
        }
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.newRoom.selector;
        selectors[1] = handler.deposit.selector;
        selectors[2] = handler.join.selector;
        selectors[3] = handler.leave.selector;
        selectors[4] = handler.start.selector;
        selectors[5] = handler.settle.selector;
        selectors[6] = handler.expireAndRefund.selector;
        selectors[7] = handler.withdraw.selector;
        selectors[8] = handler.withdrawTreasury.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_ActualMONCoversAllLiabilities() public view {
        assertGe(address(vault).balance, vault.totalLiabilities());
        assertEq(address(vault).balance, vault.totalLiabilities());
    }

    function invariant_PlayerLedgersMatchGlobalBuckets() public view {
        uint256 available;
        uint256 bid;
        uint256 skill;
        for (uint256 i; i < 3; i++) {
            address actor = handler.actors(i);
            available += vault.availableBalanceOf(actor);
            bid += vault.lockedBalanceOf(actor);
            skill += vault.skillReservedOf(actor);
            if (vault.activeRoomOf(actor) == bytes32(0)) {
                assertEq(vault.lockedBalanceOf(actor), 0);
                assertEq(vault.skillReservedOf(actor), 0);
            }
        }
        assertEq(available, vault.totalAvailableBalance());
        assertEq(bid, vault.totalBidLocked());
        assertEq(skill, vault.totalSkillReserved());
    }
}
