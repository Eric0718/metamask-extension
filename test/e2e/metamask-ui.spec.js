const { strict: assert } = require('assert');
const path = require('path');

const enLocaleMessages = require('../../app/_locales/en/messages.json');
const createStaticServer = require('../../development/create-static-server');
const {
  tinyDelayMs,
  regularDelayMs,
  largeDelayMs,
  veryLargeDelayMs,
} = require('./helpers');
const { buildWebDriver } = require('./webdriver');
const Ganache = require('./ganache');
const { ensureXServerIsRunning } = require('./x-server');

const ganacheServer = new Ganache();
const dappPort = 8080;

describe('MetaMask', function () {
  let driver;
  let dappServer;
  let tokenAddress;

  const testSeedPhrase =
    'phrase upgrade clock rough situate wedding elder clever doctor stamp excess tent';

  this.bail(true);

  let failed = false;

  before(async function () {
    await ganacheServer.start();
    const dappDirectory = path.resolve(
      __dirname,
      '..',
      '..',
      'node_modules',
      '@metamask',
      'test-dapp',
      'dist',
    );
    dappServer = createStaticServer(dappDirectory);
    dappServer.listen(dappPort);
    await new Promise((resolve, reject) => {
      dappServer.on('listening', resolve);
      dappServer.on('error', reject);
    });
    if (
      process.env.SELENIUM_BROWSER === 'chrome' &&
      process.env.CI === 'true'
    ) {
      await ensureXServerIsRunning();
    }
    const result = await buildWebDriver();
    driver = result.driver;
    await driver.navigate();
  });

  afterEach(async function () {
    if (process.env.SELENIUM_BROWSER === 'chrome') {
      const errors = await driver.checkBrowserForConsoleErrors(driver);
      if (errors.length) {
        const errorReports = errors.map((err) => err.message);
        const errorMessage = `Errors found in browser console:\n${errorReports.join(
          '\n',
        )}`;
        console.error(new Error(errorMessage));
      }
    }
    if (this.currentTest.state === 'failed') {
      failed = true;
      await driver.verboseReportOnFailure(this.currentTest.title);
    }
  });

  after(async function () {
    if (process.env.E2E_LEAVE_RUNNING === 'true' && failed) {
      return;
    }
    await ganacheServer.quit();
    await driver.quit();
    await new Promise((resolve, reject) => {
      dappServer.close((error) => {
        if (error) {
          return reject(error);
        }
        return resolve();
      });
    });
  });

  describe('Going through the first time flow', function () {
    it('clicks the continue button on the welcome screen', async function () {
      await driver.findElement('.welcome-page__header');
      await driver.clickElement({
        text: enLocaleMessages.getStarted.message,
        tag: 'button',
      });
      await driver.delay(largeDelayMs);
    });

    it('clicks the "Create New Wallet" option', async function () {
      await driver.clickElement({ text: 'Create a Wallet', tag: 'button' });
      await driver.delay(largeDelayMs);
    });

    it('clicks the "No thanks" option on the metametrics opt-in screen', async function () {
      await driver.clickElement('.btn-secondary');
      await driver.delay(largeDelayMs);
    });

    it('accepts a secure password', async function () {
      await driver.fill(
        '.first-time-flow__form #create-password',
        'correct horse battery staple',
      );
      await driver.fill(
        '.first-time-flow__form #confirm-password',
        'correct horse battery staple',
      );

      await driver.clickElement('.first-time-flow__checkbox');

      await driver.clickElement('.first-time-flow__form button');
      await driver.delay(regularDelayMs);
    });

    let seedPhrase;

    it('renders the Secret Recovery Phrase intro screen', async function () {
      await driver.clickElement('.seed-phrase-intro__left button');
      await driver.delay(regularDelayMs);
    });

    it('reveals the Secret Recovery Phrase', async function () {
      const byRevealButton =
        '.reveal-seed-phrase__secret-blocker .reveal-seed-phrase__reveal-button';
      await driver.findElement(byRevealButton);
      await driver.clickElement(byRevealButton);
      await driver.delay(regularDelayMs);

      const revealedSeedPhrase = await driver.findElement(
        '.reveal-seed-phrase__secret-words',
      );
      seedPhrase = await revealedSeedPhrase.getText();
      assert.equal(seedPhrase.split(' ').length, 12);
      await driver.delay(regularDelayMs);

      await driver.clickElement({
        text: enLocaleMessages.next.message,
        tag: 'button',
      });
      await driver.delay(regularDelayMs);
    });

    async function clickWordAndWait(word) {
      await driver.clickElement(
        `[data-testid="seed-phrase-sorted"] [data-testid="draggable-seed-${word}"]`,
      );
      await driver.delay(tinyDelayMs);
    }

    it('can retype the Secret Recovery Phrase', async function () {
      const words = seedPhrase.split(' ');

      for (const word of words) {
        await clickWordAndWait(word);
      }

      await driver.clickElement({ text: 'Confirm', tag: 'button' });
      await driver.delay(regularDelayMs);
    });

    it('clicks through the success screen', async function () {
      await driver.findElement({ text: 'Congratulations', tag: 'div' });
      await driver.clickElement({
        text: enLocaleMessages.endOfFlowMessage10.message,
        tag: 'button',
      });
      await driver.delay(regularDelayMs);
    });
  });

  describe('Import Secret Recovery Phrase', function () {
    it('logs out of the vault', async function () {
      await driver.clickElement('.account-menu__icon');
      await driver.delay(regularDelayMs);

      const lockButton = await driver.findClickableElement(
        '.account-menu__lock-button',
      );
      assert.equal(await lockButton.getText(), 'Lock');
      await lockButton.click();
      await driver.delay(regularDelayMs);
    });

    it('imports Secret Recovery Phrase', async function () {
      const restoreSeedLink = await driver.findClickableElement(
        '.unlock-page__link',
      );
      assert.equal(await restoreSeedLink.getText(), 'Forgot password?');
      await restoreSeedLink.click();
      await driver.delay(regularDelayMs);

      await driver.pasteIntoField(
        '[data-testid="import-srp__srp-word-0"]',
        testSeedPhrase,
      );

      await driver.fill('#password', 'correct horse battery staple');
      await driver.fill('#confirm-password', 'correct horse battery staple');
      await driver.clickElement({
        text: enLocaleMessages.restore.message,
        tag: 'button',
      });
      await driver.delay(regularDelayMs);
    });

    it('balance renders', async function () {
      await driver.waitForSelector({
        css: '[data-testid="wallet-balance"] .list-item__heading',
        text: '1000',
      });
      await driver.delay(regularDelayMs);
    });
  });

  describe('Send token from inside MetaMask', function () {
    it('starts to send a transaction', async function () {
      await driver.clickElement('[data-testid="eth-overview-send"]');
      await driver.delay(regularDelayMs);

      await driver.fill(
        'input[placeholder="Search, public address (0x), or ENS"]',
        '0x2f318C334780961FB129D2a6c30D0763d9a5C970',
      );

      driver.fill('.unit-input__input', '1');
    });

    it('transitions to the confirm screen', async function () {
      // Continue to next screen
      await driver.delay(largeDelayMs);
      await driver.clickElement({ text: 'Next', tag: 'button' });
      await driver.delay(largeDelayMs);
    });

    it('displays the token transfer data', async function () {
      await driver.delay(largeDelayMs);
      await driver.clickElement({ text: 'Hex', tag: 'button' });
      await driver.delay(regularDelayMs);

      const functionType = await driver.findElement(
        '.confirm-page-container-content__function-type',
      );
      const functionTypeText = await functionType.getText();
      assert(functionTypeText.match('Transfer'));

      const tokenAmount = await driver.findElement(
        '.confirm-page-container-summary__title-text',
      );
      const tokenAmountText = await tokenAmount.getText();
      assert.equal(tokenAmountText, '1 TST');

      const confirmDataDiv = await driver.findElement(
        '.confirm-page-container-content__data-box',
      );
      const confirmDataText = await confirmDataDiv.getText();

      await driver.delay(regularDelayMs);
      assert(
        confirmDataText.match(
          /0xa9059cbb0000000000000000000000002f318c334780961fb129d2a6c30d0763d9a5c97/u,
        ),
      );

      await driver.clickElement({ text: 'Details', tag: 'button' });
      await driver.delay(regularDelayMs);
    });

    it('customizes gas', async function () {
      await driver.clickElement({ text: 'Edit', tag: 'button' });
      await driver.delay(largeDelayMs);
      const inputs = await driver.findElements('input[type="number"]');
      const gasLimitInput = inputs[0];
      const gasPriceInput = inputs[1];
      await gasLimitInput.fill('100000');
      await gasPriceInput.fill('100');
      await driver.delay(veryLargeDelayMs);
      await driver.clickElement({ text: 'Save', tag: 'button' });
      await driver.delay(veryLargeDelayMs);
    });

    it('submits the transaction', async function () {
      await driver.clickElement({ text: 'Confirm', tag: 'button' });
      await driver.delay(regularDelayMs);
    });

    it('finds the transaction in the transactions list', async function () {
      await driver.waitForSelector(
        {
          css:
            '.transaction-list__completed-transactions .transaction-list-item__primary-currency',
          text: '-1 TST',
        },
        { timeout: 10000 },
      );

      await driver.waitForSelector({
        css: '.list-item__heading',
        text: 'Send TST',
      });
    });
  });

  describe('Send a custom token from dapp', function () {
    it('sends an already created token', async function () {
      const windowHandles = await driver.getAllWindowHandles();
      const extension = windowHandles[0];
      const dapp = await driver.switchToWindowWithTitle(
        'E2E Test Dapp',
        windowHandles,
      );
      await driver.delay(regularDelayMs);

      await driver.switchToWindow(dapp);
      await driver.delay(tinyDelayMs);

      await driver.clickElement({ text: 'Transfer Tokens', tag: 'button' });

      await driver.switchToWindow(extension);
      await driver.delay(largeDelayMs);

      await driver.findElements('.transaction-list__pending-transactions');
      await driver.waitForSelector(
        {
          css: '.transaction-list-item__primary-currency',
          text: '-1.5 TST',
        },
        { timeout: 10000 },
      );
      await driver.clickElement('.transaction-list-item__primary-currency');
      await driver.delay(regularDelayMs);

      const transactionAmounts = await driver.findElements(
        '.currency-display-component__text',
      );
      const transactionAmount = transactionAmounts[0];
      assert(await transactionAmount.getText(), '1.5 TST');
    });

    it('customizes gas', async function () {
      await driver.delay(veryLargeDelayMs);
      await driver.clickElement({ text: 'Edit', tag: 'button' });
      await driver.delay(veryLargeDelayMs);
      await driver.clickElement(
        { text: 'Edit suggested gas fee', tag: 'button' },
        10000,
      );
      await driver.delay(veryLargeDelayMs);
      const inputs = await driver.findElements('input[type="number"]');
      const gasLimitInput = inputs[0];
      const gasPriceInput = inputs[1];
      await gasLimitInput.fill('60000');
      await gasPriceInput.fill('10');
      await driver.delay(veryLargeDelayMs);
      await driver.clickElement({ text: 'Save', tag: 'button' });
      await driver.delay(veryLargeDelayMs);
      await driver.findElement({ tag: 'span', text: '0.0006' });
    });

    it('submits the transaction', async function () {
      const tokenAmount = await driver.findElement(
        '.confirm-page-container-summary__title-text',
      );
      const tokenAmountText = await tokenAmount.getText();
      assert.equal(tokenAmountText, '1.5 TST');

      await driver.clickElement({ text: 'Confirm', tag: 'button' });
      await driver.delay(regularDelayMs);
    });

    it('finds the transaction in the transactions list', async function () {
      await driver.waitForSelector({
        css:
          '.transaction-list__completed-transactions .transaction-list-item__primary-currency',
        text: '-1.5 TST',
      });

      await driver.waitForSelector({
        css: '.list-item__heading',
        text: 'Send TST',
      });
    });

    it('checks balance', async function () {
      await driver.clickElement({
        text: 'Assets',
        tag: 'button',
      });

      await driver.waitForSelector({
        css: '.asset-list-item__token-button',
        text: '7.5 TST',
      });

      await driver.clickElement({
        text: 'Activity',
        tag: 'button',
      });
    });
  });

  describe('Transfers a custom token from dapp when no gas value is specified', function () {
    it('transfers an already created token, without specifying gas', async function () {
      const windowHandles = await driver.getAllWindowHandles();
      const extension = windowHandles[0];
      const dapp = await driver.switchToWindowWithTitle(
        'E2E Test Dapp',
        windowHandles,
      );
      await driver.closeAllWindowHandlesExcept([extension, dapp]);
      await driver.delay(regularDelayMs);

      await driver.switchToWindow(dapp);

      await driver.clickElement({
        text: 'Transfer Tokens Without Gas',
        tag: 'button',
      });

      await driver.switchToWindow(extension);
      await driver.delay(regularDelayMs);

      await driver.wait(async () => {
        const pendingTxes = await driver.findElements(
          '.transaction-list__pending-transactions .transaction-list-item',
        );
        return pendingTxes.length === 1;
      }, 10000);

      await driver.waitForSelector({
        css: '.transaction-list-item__primary-currency',
        text: '-1.5 TST',
      });
      await driver.clickElement('.transaction-list-item');
      await driver.delay(regularDelayMs);
    });

    it('submits the transaction', async function () {
      await driver.delay(largeDelayMs * 2);
      await driver.clickElement({ text: 'Confirm', tag: 'button' });
      await driver.delay(largeDelayMs * 2);
    });

    it('finds the transaction in the transactions list', async function () {
      await driver.waitForSelector({
        // Select the heading of the first transaction list item in the
        // completed transaction list with text matching Send TST
        css:
          '.transaction-list__completed-transactions .transaction-list-item:first-child .list-item__heading',
        text: 'Send TST',
      });

      await driver.waitForSelector({
        css:
          '.transaction-list__completed-transactions .transaction-list-item:first-child .transaction-list-item__primary-currency',
        text: '-1.5 TST',
      });
    });
  });
});
