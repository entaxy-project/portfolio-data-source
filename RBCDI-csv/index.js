const glob = require('glob')
const Promise = require('bluebird')
const _ = require('lodash')
const path = require('path')
const fs = require('fs')
const csv = require('fast-csv')
const uuidV4 = require('uuid/v4')
const moment = require('moment')

function getCSVs (paths) {
  return new Promise((resolve, reject) => {
    glob(paths, (err, files) => {
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

function getTransactions (csvContent) {
  return new Promise((resolve, reject) => {
    let transactions = []
    csv
      .fromString(_.trim(csvContent), {headers: true})
      .on('data', (data) => transactions.push(data))
      .on('end', () => resolve(transactions))
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

function parseActivitiesCSVFile (pathToCSV) {
  let csvContent = fs.readFileSync(pathToCSV).toString()

  const footerData = csvContent.indexOf('Disclaimer')
  csvContent = csvContent.substr(0, footerData)

  const transactionsHeaderLocation = csvContent.indexOf('Date,Activity,Symbol,Quantity,Price,Settlement Date,Account,Value,Currency,Description')
  const transactionsData = csvContent.substr(transactionsHeaderLocation)

  return Promise
    .all([
      getAccountNumber(csvContent),
      getTransactions(transactionsData)
    ])
    .spread((accountNumber, transactions) => Promise
      .resolve({
        account: {
          institution: 'rbcdi',
          uuid: uuidV4(),
          number: accountNumber
        },
        transactions,
        normalizedTransactions: _.reduce(transactions, (result, transaction) => {
          if (transaction.Activity !== 'Buy' && transaction.Activity !== 'Sell') {
            return result
          }
          result.push({
            id: uuidV4(),
            source: 'rbcdi',
            date: moment(transaction.Date, 'MMM D YYYY').toISOString(),
            type: transaction.Activity.toLowerCase(),
            description: _.trim(transaction.Description),
            units: Math.abs(parseFloat(transaction.Quantity)),
            symbol: transaction.Symbol,
            fiatAmount: Math.abs(parseFloat(transaction.Value)),
            fiatCurrency: transaction.Currency,
            pricePerUnit: Math.abs(parseFloat(transaction.Price))
          })
          return result
        }, [])
      })
    )

}

function parseHoldingsCSVFile (pathToCSV) {
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
          institution: 'rbcdi',
          uuid: uuidV4(),
          number: accountNumber,
          ...accountStats
        },
        positions: holdings,
        normalizedPositions: _.map(holdings, (holding) => {
          const symbol = `${holding.Symbol}.${    (holding.Currency === 'CAD') ? 'TO' : 'USDPLACEHOLDER' }`
          return {
            symbol,
            quantity: Math.abs(parseFloat(holding.Quantity)),
            marketValue: Math.abs(parseFloat(holding['Total Market Value'])),
            bookValue: Math.abs(parseFloat(holding['Total Book Cost'])),
            price: Math.abs(parseFloat(holding['Last Price'])),
            averagePrice: Math.abs(parseFloat(holding['Total Book Cost'])) / Math.abs(parseFloat(holding.Quantity)),
            pl: Math.abs(parseFloat(holding['Total Market Value'])) - Math.abs(parseFloat(holding['Total Book Cost']))
          }
        }),
        balances: cash
      })
    )
}

Promise
  .all([
    getCSVs('./holdings/Holdings*.csv')
      .then((files) => Promise
        .map(files, (file) => {
          const pathToCSV = path.join(__dirname, file)
          return parseHoldingsCSVFile(pathToCSV)
        })
      ),
    getCSVs('./holdings/Activity*.csv')
      .then((files) => Promise
        .map(files, (file) => {
          const pathToCSV = path.join(__dirname, file)
          return parseActivitiesCSVFile(pathToCSV)
        })
      )
  ])
  .spread((holdings, transactions) => {
    const accountNumbers = _.uniq(_.flatten([
      _.map(holdings, 'account.number'),
      _.map(transactions, 'account.number')
    ]))
    return _.map(accountNumbers, (accountNumber) => {
      const holding = _.find(holdings, (holding) => (_.get(holding, 'account.number') === accountNumber))
      const transaction = _.find(transactions, (transaction) => (_.get(transaction, 'account.number') === accountNumber))
      return _.merge(holding, transaction)
    })
  })
  .then((data) => {
    console.log(JSON.stringify(data, undefined, 2))
  })
