# RBCDI Portfolio Fetcher

This is a quick Proof of Concept for fetching portfolio data from your Questrade account manually.

## How to use

**Step 1: Log into RBCDI and go to holdings page**

**Step 2: Export data as CSV and save to the `holdings` folder**

**Step 3: Run the node program**

**Step 4: Use the JSON in the React app**


## Issues

The example holdings only contains ETFs and stocks.

Need exports containing:

- Bonds
- Mutual Fonds
- GICs
- Metals
- What else am I missing here?

Also, there is no way to automatically determine the account type, since at most it returns a number for the account
