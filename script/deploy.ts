// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, network } from "hardhat";

import ERC721PresetMinterPauserAutoIdArtifact
    from "@openzeppelin/contracts/build/contracts/ERC721PresetMinterPauserAutoId.json";
import { ERC721PresetMinterPauserAutoId } from "../typechain-types";
import { ERC6551Registry } from "../typechain-types/src";
import { ERC6551AccountUpgradeable, ERC6551AccountProxy } from "../typechain-types/src/examples/upgradeable";

const hre = require("hardhat");

const DEPLOY_NFT = true;
const DEPLOY_REGISTRY = false;
const CREATE_ACCOUNT = true;
const VERIFY = true;
const VERIFY_ONLY = false;
const PREDEPLOYED_REGISTRY_ADDRESS = "0x02101dfB77FDE026414827Fdc604ddAF224F0921";  // Mainnet/testnet address
// const PREDEPLOYED_REGISTRY_ADDRESS = "0x9A676e781A523b5d0C0e43731313A708CB607508";   // Local environment address
const PREDEPLOYED_NFT_ADDRESS = "0x0000000000000000000000000000000000000000";
const CHAIN_ID = network.config.chainId !== undefined ? network.config.chainId : -1;

async function main() {
    // Hardhat always runs the compile task when running scripts with its command
    // line interface.
    //
    // If this script is run directly using `node` you may want to call compile
    // manually to make sure everything is compiled
    // await hre.run('compile');
    if (!VERIFY_ONLY) {
        const signers = await ethers.getSigners();

        const NFT = await ethers.getContractFactory(ERC721PresetMinterPauserAutoIdArtifact.abi, ERC721PresetMinterPauserAutoIdArtifact.bytecode);
        const nftArgs = ["Test Profile", "profile0", "http://"];

        let nftInstance;

        // Deploy a profile NFT
        if (DEPLOY_NFT) {
            nftInstance = (await NFT.deploy(...nftArgs)) as ERC721PresetMinterPauserAutoId;
            await nftInstance.deployed();
            console.log("Test Profile ERC721 deployed at:", nftInstance.address);
            await nftInstance.mint(signers[0].address);
            console.log("Minted an NFT to address:", signers[0].address);
        } else {
            nftInstance = NFT.attach(PREDEPLOYED_NFT_ADDRESS) as ERC721PresetMinterPauserAutoId;
            console.log("Using predeployed ERC721 at address:", nftInstance.address)
        }

        const Registry = await ethers.getContractFactory("ERC6551Registry");
        let registryInstance;

        // Deploy registry
        if (DEPLOY_REGISTRY) {
            const registry = await Registry.deploy();
            registryInstance = await registry.deployed();
            console.log("Deployed registry to address:", registryInstance.address);
        } else {
            registryInstance = Registry.attach(PREDEPLOYED_REGISTRY_ADDRESS) as ERC6551Registry;
            console.log("Using predeployed registry at address:", registryInstance.address);
        }

        // Deploy factory implementation instance
        const Implementation = await ethers.getContractFactory("ERC6551AccountUpgradeable");
        const implementation = await Implementation.deploy();
        const implementationInstance = await implementation.deployed();
        console.log("Deployed implementation reference instance at address:", implementationInstance.address)

        // Deploy factory proxy instance
        const Proxy = await ethers.getContractFactory("ERC6551AccountProxy");
        const proxyArgs = [implementationInstance.address];
        const proxy = await Proxy.deploy(proxyArgs[0]);
        const proxyInstance = await proxy.deployed();
        console.log("Deployed proxy reference instance at address:", proxyInstance.address)

        // Handle optional account creation
        const Wallet = await ethers.getContractFactory("ERC6551AccountUpgradeable");
        let smartWalletInstance;

        if (CREATE_ACCOUNT) {
            let tokenId = 0;
            let salt = 0;
            // Submit txn to create new account 
            let deployTxn = await registryInstance.createAccount(
                proxyInstance.address,
                CHAIN_ID,
                nftInstance.address,
                tokenId,
                salt,
                []
            );
            // Wait for transaction to be mined
            await deployTxn.wait();
            // Get new wallet proxy address from registry.
            let smartWalletAddress = await registryInstance.account(
                proxyInstance.address,
                CHAIN_ID,
                nftInstance.address,
                tokenId,
                salt
            );
            console.log("Smart wallet proxy created at:", smartWalletAddress);
            // Attach proxy to smart wallet ABI  
            smartWalletInstance = Wallet.attach(smartWalletAddress);
        } else {
            smartWalletInstance = Wallet.attach("0x0000000000000000000000000000000000000000");
        }

        if (VERIFY) {
            // Verify contracts
            console.log("Waiting 60s before verifying contracts...");
            await new Promise((resolve) => setTimeout(resolve, 60000));
            await verifyContracts(
                nftInstance.address,
                nftArgs,
                registryInstance.address,
                implementationInstance.address,
                proxyInstance.address,
                proxyArgs,
                smartWalletInstance.address);
        }
    } else {
        let nftInstance = "0x0000000000000000000000000000000000000000";
        let nftArgs = ["Test Profile", "profile0", "http://"];
        let registryInstance = "0x0000000000000000000000000000000000000000";
        let implementationInstance = "0x0000000000000000000000000000000000000000";
        let proxyInstance = "0x0000000000000000000000000000000000000000";
        let proxyArgs = ["0x0"];
        let smartWalletInstance = "0x0000000000000000000000000000000000000000";

        await verifyContracts(
            nftInstance,
            nftArgs,
            registryInstance,
            implementationInstance,
            proxyInstance,
            proxyArgs,
            smartWalletInstance);
    }
}


async function verifyContracts(
    nftInstance: string,
    nftArgs: any[],
    registryInstance: string,
    implementationInstance: string,
    proxyInstance: string,
    proxyArgs: any[],
    smartWalletProxyInstance: string
): Promise<void> {
    async function verify(address: string, label: string, constructorArguments?: any[]): Promise<void> {
        try {
            console.log(`Verifying ${label}`);
            await hre.run("verify:verify", {
                address: address,
                constructorArguments: constructorArguments,
            });
        } catch (error) {
            console.error(`Error verifying ${label}:`, error);
        }
        console.log("-------------------------------------------------------");
    }

    if (DEPLOY_NFT) {
        await verify(nftInstance, "ERC721", nftArgs);
    }

    if (DEPLOY_REGISTRY) {
        await verify(registryInstance, "Registry");
    }

    await verify(implementationInstance, "Implementation Reference");
    await verify(proxyInstance, "Proxy Reference", proxyArgs);

    if (CREATE_ACCOUNT) {
        await verify(smartWalletProxyInstance, "Smart Wallet Proxy");
    }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});