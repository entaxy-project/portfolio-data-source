const glob = require('glob')
const Promise = require('bluebird')
const _ = require('lodash')
const path = require('path')
const fs = require('fs')
const csv = require('fast-csv')

function getCSVs () {
  return new Promise((resolve, reject) => {
    glob('./holdings/Holdings*.csv', (err, files) => {
      if (err) {
        reject(err)
      } else {
        resolve(files)
      }
    })
  })
}

function getAccountStats (csvContent) {
  return new Promise((resolve, reject) => {
    let accountStats = {}
    csv
      .fromString(_.trim(csvContent), {headers: true})
      .on('data', (data) => {
        accountStats = data
        delete accountStats['']
      })
      .on('end', () => resolve(accountStats))
      .on('error', (err) => reject(err))
  })
}

function getCash (csvContent) {
  return new Promise((resolve, reject) => {
    let cashs = []
    csv
      .fromString(_.trim(csvContent), {headers: true})
      .on('data', (data) => cashs.push(data))
      .on('end', () => resolve(cashs))
      .on('error', (err) => reject(err))
  })
}

function getHoldings (csvContent) {
  return new Promise((resolve, reject) => {
    let holdings = []
    csv
      .fromString(_.trim(`Holding Type${csvContent}`), {headers: true})
      .on('data', (data) => holdings.push(data))
      .on('end', () => resolve(holdings))
      .on('error', (err) => reject(err))
  })
}

function getAccountNumber (csvContent) {
  return new Promise((resolve, reject) => {
    const accountNumberRegex = /Account: (.+?)$/im
    const accountNumber = csvContent.match(accountNumberRegex)
    if (accountNumber) {
      resolve(accountNumber[1])
    } else {
      reject(new Error('Account number not found'))
    }
  })
}

function parseCSVFile (pathToCSV) {
  let csvContent = fs.readFileSync(pathToCSV).toString()

  const footerData = csvContent.indexOf('Important Information')
  csvContent = csvContent.substr(0, footerData)

  const holdingsHeaderLocation = csvContent.indexOf(',Product,Symbol,Name,Quantity,Last Price,Currency,Change $,Change %,Total Book Cost,Total Market Value,Unrealized Gain/Loss $,Unrealized Gain/Loss %,Average Cost,Annual Dividend Amount $,Dividend Ex Date,Load Type,RSP Eligibility,Automatic Investment Plan,DRIP Eligibility,Coupon Rate,Maturity Date,Expiration Date,Open Interest')
  const holdingsData = csvContent.substr(holdingsHeaderLocation)
  csvContent = csvContent.substr(0, holdingsHeaderLocation)

  const cashHeaderLocation = csvContent.indexOf('Currency,Cash,Investments,Total')
  const cashData = csvContent.substr(cashHeaderLocation)
  csvContent = csvContent.substr(0, cashHeaderLocation)

  const accountStatsHeaderLocation = csvContent.indexOf(',Trailing 12 Mo Return,Unrealized Gain/Loss in CAD,Unrealized Gain/Loss in CAD (%),Combined Book Cost in CAD,Combined Book Cost in USD,Combined Total in CAD,Combined Total in USD')
  const accountStatsData = csvContent.substr(accountStatsHeaderLocation)
  csvContent = csvContent.substr(0, accountStatsHeaderLocation)

  return Promise
    .all([
      getAccountNumber(csvContent),
      getHoldings(holdingsData),
      getCash(cashData),
      getAccountStats(accountStatsData)
    ])
    .spread((accountNumber, holdings, cash, accountStats) => Promise
      .resolve({
        account: {
          number: accountNumber,
          ...accountStats
        },
        positions: holdings,
        balances: cash
      })
    )
}

getCSVs()
  .then((files) => Promise
    .map(files, (file) => {
      const pathToCSV = path.join(__dirname, file)
      return parseCSVFile(pathToCSV)
    })
  )
  .then((data) => {
    console.log(JSON.stringify(data, undefined, 2))
  })
