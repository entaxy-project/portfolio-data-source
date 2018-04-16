const Promise = require('bluebird')
const fetch = require('node-fetch')
const _ = require('lodash')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const uuidV4 = require('uuid/v4')
const moment = require('moment')

fetch.Promise = Promise

const tokenFile = path.join(__dirname, 'token')

function getToken (token) {
  if (_.isNil(token)) {
    throw new Error()
  }
  return fetch(`https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token=${token}`, {
    method: 'POST',
    body: `grant_type=refresh_token&refresh_token=${token}`
  })
    .then(res => res.json())
}

function readToken () {
  let token = process.argv[2]
  if (_.isNil(token)) {
    let tokenFileStructure
    try {
      const tokenFileContent = fs.readFileSync(tokenFile).toString()
      tokenFileStructure = JSON.parse(tokenFileContent)
      token = tokenFileStructure.refresh_token
    } catch (e) {
      return Promise.reject(new Error())
    }
  }
  return Promise.resolve(token)
}

function getAccounts (questradeHost, accessToken) {
  return fetch(`${questradeHost}v1/accounts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
    .then(res => res.json())
}

function getPositions (questradeHost, accessToken, accountId) {
  return fetch(`${questradeHost}v1/accounts/${accountId}/positions`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
    .then(res => res.json())
    .then((data) => Promise.resolve(data.positions))
}

function getBalances (questradeHost, accessToken, accountId) {
  return fetch(`${questradeHost}v1/accounts/${accountId}/balances`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
    .then(res => res.json())
}

function getActivities (questradeHost, accessToken, accountId) {
  const getActivitiesForDateRanges = (questradeHost, accessToken, accountId, startTime, endTime) => {
    return fetch(`${questradeHost}v1/accounts/${accountId}/activities?startTime=${startTime}&endTime=${endTime}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
      .then(res => res.json())
  }

  // Get 4 years worth of activities
  const monthsOfDataToFetch = 4 * 12
  let endOfPeriod = moment().endOf('day')

  const periods = []
  _.times(monthsOfDataToFetch, () => {
    let startOfPeriod = endOfPeriod.clone().subtract(30, 'day')
    periods.push({
      startOfPeriod,
      endOfPeriod
    })
    endOfPeriod = startOfPeriod
  })

  return Promise
    .map(periods, (period) => {
      return getActivitiesForDateRanges(questradeHost, accessToken, accountId, period.startOfPeriod.toISOString(), period.endOfPeriod.toISOString())
        .delay(50)
    }, {concurrency: 1})
    .then((data) => Promise.resolve(_.flatten(_.map(data, 'activities'))))
}

readToken()
  .then((token) => getToken(token))
  .tap((data) => {
    data.written = Date.now()
    fs.writeFileSync(tokenFile, JSON.stringify(data), 'ascii')
  })
  .then((data) => {
    const questradeHost = data.api_server
    const accessToken = data.access_token
    return getAccounts(questradeHost, accessToken)
      .then((rawAccounts) => {
        const {accounts, userId} = rawAccounts
        return Promise.map(accounts, (account) => {
          const number = account.number
          // account.number = crypto.createHash('sha1').update(account.number).digest('hex')
          return Promise
            .all([
              getPositions(questradeHost, accessToken, number),
              getBalances(questradeHost, accessToken, number),
              getActivities(questradeHost, accessToken, number),
            ])
            .spread((positions, balances, activities) => Promise
              .resolve({
                account: {
                  institution: 'questrade',
                  uuid: uuidV4(),
                  ...account
                },
                positions,
                normalizedPositions: _.map(positions, (position) => {
                  return {
                    symbol: position.symbol,
                    quantity: position.openQuantity,
                    marketValue: position.currentMarketValue,
                    bookValue: position.totalCost,
                    price: position.currentPrice,
                    averagePrice: position.averageEntryPrice,
                    pl: position.openPnl
                  }
                }),
                balances,
                activities,
                normalizedTransactions: _.reduce(activities, (result, activity) => {
                  if (activity.type !== 'Trades') {
                    return result
                  }
                  result.push({
                    id: uuidV4(),
                    source: 'questrade',
                    date: activity.tradeDate,
                    type: activity.action.toLowerCase(),
                    description: _.trim(activity.description),
                    units: Math.abs(activity.quantity),
                    symbol: activity.symbol,
                    fiatAmount: Math.abs(activity.grossAmount),
                    fiatCurrency: activity.currency,
                    pricePerUnit: activity.price
                  })
                  return result
                }, [])
              })
            )
        })
      })
  })
  .then((positions) => {
    console.log(JSON.stringify(positions, undefined, 2))
  })
  .catch((err) => {
    console.warn('Error happened:')
    console.warn('Maybe try with a new token from the API dashboard?')
    console.warn(err)
  })
