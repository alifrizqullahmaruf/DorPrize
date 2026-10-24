// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {NativeGameVault} from "../src/NativeGameVault.sol";

/// @notice New deployment, signed through Foundry's keystore/unlocked local account, never an env private key.
/// @dev Does not write a deployment record during simulation. Record only after a confirmed creation receipt.
contract DeployNative is Script {
    function run() external returns (NativeGameVault vault) {
        require(block.chainid == 10143 || block.chainid == 31337, "Only Monad testnet or local Anvil");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("VAULT_OWNER");
        address operator = vm.envAddress("OPERATOR");
        address signer = vm.envAddress("BACKEND_SIGNER");
        address treasury = vm.envAddress("TREASURY");
        require(deployer != address(0), "Zero deployer");

        vm.startBroadcast(deployer);
        vault = new NativeGameVault(owner, operator, signer, treasury);
        vm.stopBroadcast();

        console2.log("chainId", block.chainid);
        console2.log("NativeGameVault", address(vault));
        console2.log("owner", owner);
        console2.log("operator", operator);
        console2.log("backendSigner", signer);
        console2.log("treasury", treasury);
    }
}
