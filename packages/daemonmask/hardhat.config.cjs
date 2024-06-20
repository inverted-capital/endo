// require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      accounts: {
        mnemonic: 'test test test test test test test test test test test ball',
      }
    }
  }
};
