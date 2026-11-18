// TemperatureLog (contracts/TemperatureLog.sol): only what the batch page reads.
// Regenerate from artifacts/contracts/TemperatureLog.sol/TemperatureLog.json if it changes.
export const temperatureAbi = [
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
        "internalType": "uint32",
        "name": "leg",
        "type": "uint32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "custodian",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "sensor",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "startTime",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "endTime",
            "type": "uint64"
          },
          {
            "internalType": "int16",
            "name": "minCentiC",
            "type": "int16"
          },
          {
            "internalType": "int16",
            "name": "maxCentiC",
            "type": "int16"
          },
          {
            "internalType": "uint32",
            "name": "secondsOutOfRange",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "readingCount",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "firstSeq",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "lastSeq",
            "type": "uint32"
          },
          {
            "internalType": "bytes32",
            "name": "logRoot",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "recordedAt",
            "type": "uint64"
          }
        ],
        "indexed": false,
        "internalType": "struct TemperatureLog.Record",
        "name": "record",
        "type": "tuple"
      }
    ],
    "name": "SummaryRecorded",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "batchId",
        "type": "bytes32"
      },
      {
        "internalType": "uint32",
        "name": "leg",
        "type": "uint32"
      }
    ],
    "name": "getSummary",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "custodian",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "sensor",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "startTime",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "endTime",
            "type": "uint64"
          },
          {
            "internalType": "int16",
            "name": "minCentiC",
            "type": "int16"
          },
          {
            "internalType": "int16",
            "name": "maxCentiC",
            "type": "int16"
          },
          {
            "internalType": "uint32",
            "name": "secondsOutOfRange",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "readingCount",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "firstSeq",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "lastSeq",
            "type": "uint32"
          },
          {
            "internalType": "bytes32",
            "name": "logRoot",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "recordedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TemperatureLog.Record",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rangeHighCentiC",
    "outputs": [
      {
        "internalType": "int16",
        "name": "",
        "type": "int16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rangeLowCentiC",
    "outputs": [
      {
        "internalType": "int16",
        "name": "",
        "type": "int16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "sensorOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];
