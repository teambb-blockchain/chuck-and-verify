export const abi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registryAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BatchAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyBatchId",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoPendingShipment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotCurrentHolder",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotPendingReceiver",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Unauthorized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "processor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "weightLbs",
        "type": "uint256"
      }
    ],
    "name": "BatchRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "inspector",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "passed",
        "type": "bool"
      }
    ],
    "name": "InspectionRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "by",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "noticeHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "classification",
        "type": "uint8"
      }
    ],
    "name": "RecallRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "ReceiptConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      }
    ],
    "name": "ShipmentRecorded",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "CRED_CUSTODIAN",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CRED_INSPECTOR",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CRED_PROCESSOR",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      }
    ],
    "name": "confirmReceipt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      }
    ],
    "name": "getBatch",
    "outputs": [
      {
        "internalType": "address",
        "name": "processor",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "weightLbs",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "currentHolder",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "pendingReceiver",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "inspected",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "inspectionPassed",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "inspectionReportHash",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "recalled",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "recallNoticeHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "recallClassification",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "reportHash",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "passed",
        "type": "bool"
      }
    ],
    "name": "recordInspection",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "noticeHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "classification",
        "type": "uint8"
      }
    ],
    "name": "recordRecall",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      }
    ],
    "name": "recordShipment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "weightLbs",
        "type": "uint256"
      }
    ],
    "name": "registerBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "registry",
    "outputs": [
      {
        "internalType": "contract ICredentialRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];
