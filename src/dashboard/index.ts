import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainEvent,
  shell,
} from 'electron'
import Firefox from '../firefox'
import Node from '../node'
import helpers from '../../shared/helpers'
import { getIdentifier } from '../../shared/getIdentifier'
import baseWindowConfig from '../../shared/windowConfig'
import axios from 'axios'
import Logger from '../../shared/logger'
import Uninstaller from '../uninstaller'
import { readFileSync, writeFileSync } from 'fs-extra'
import process from 'node:process'

const path = require('path')

const logger = new Logger()

let mainWindow: BrowserWindow | null
let node: Node | null
let uninstaller: Uninstaller | null
let firefox: Firefox | null

let isFirefoxRunning = false
let isLoggingOut = false

declare const DASHBOARD_WINDOW_PRELOAD_WEBPACK_ENTRY: string
declare const DASHBOARD_WINDOW_WEBPACK_ENTRY: string

const MESSAGES = {
  closeConfirmation: {
    title: 'Are you sure you want to close?',
    message:
      'Quit Point Network and Point Browser?',
    buttons: {
      confirm: 'Yes',
      cancel: 'No',
    },
  },
  logoutConfirmation: {
    title: 'Are you sure you want to log out?',
    message:
      'Do you want to close the browser and remove the secret phrase from this computer?',
    buttons: {
      confirm: 'Yes',
      cancel: 'No',
    },
  },
  uninstallConfirmation: {
    title: 'Uninstall Point Network',
    message:
      'Are you sure you want to uninstall Point Network? Clicking Yes will also close the Point Dashboard and Point Browser.',
    buttons: {
      confirm: 'Yes',
      cancel: 'No',
    },
  },
  NoInternet: {
    title: 'Connection Error',
    message: 'Please check your internet connection',
  },
  TimeOut: {
    title: 'TimeOut Error',
    message: 'Please check your internet connection or restart Point',
  },
}

// const assetsPath =
//   process.env.NODE_ENV === 'production'
//     ? process.resourcesPath
//     : app.getAppPath()

process.on('uncaughtException', (err, origin) => {
  if (err.toString().includes('send ENOBUFS')) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: MESSAGES.NoInternet.title,
      message: MESSAGES.NoInternet.message,
    })
  }

  if (err.toString().includes('ETIMEDOUT')) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: MESSAGES.TimeOut.title,
      message: MESSAGES.TimeOut.message,
    })
  }

  logger.info(`Caught exception: ${err}\n Exception origin: ${origin}`)
})

export default function (isExplicitRun = false) {
  async function createWindow() {
    mainWindow = new BrowserWindow({
      ...baseWindowConfig,
      width: 860,
      height: 560,
      webPreferences: {
        ...baseWindowConfig.webPreferences,
        preload: DASHBOARD_WINDOW_PRELOAD_WEBPACK_ENTRY,
      },
    })

    isLoggingOut = false

    node = new Node(mainWindow!)
    uninstaller = new Uninstaller(mainWindow!)
    await node.checkNodeVersion()
    firefox = new Firefox(mainWindow!)
    // debug
    // mainWindow.webContents.openDevTools()

    mainWindow.loadURL(DASHBOARD_WINDOW_WEBPACK_ENTRY)

    mainWindow.on('close', async ev => {
      // We prevent default to programatically close the window,
      // thus ensuring we await for all necessary actions to complete.
      ev.preventDefault()

      let quit = true

      if (!isLoggingOut && isFirefoxRunning) {
        const confirmationAnswer = dialog.showMessageBoxSync({
          type: 'question',
          title: MESSAGES.closeConfirmation.title,
          message: MESSAGES.closeConfirmation.message,
          buttons: [
            MESSAGES.closeConfirmation.buttons.confirm,
            MESSAGES.closeConfirmation.buttons.cancel,
          ],
        })

        if (confirmationAnswer === 1) {
          // User clicked 'No' (button at index 1)
          quit = false
        }
      }

      if (quit) {
        mainWindow?.webContents.send('dashboard:close')
        logger.info('Closed Dashboard Window')
        events.forEach(event => {
          ipcMain.removeListener(event.channel, event.listener)
          logger.info('[dashboard:index.ts] Removed event', event.channel)
        })

        try {
          await Promise.all([firefox?.close(), Node.stopNode()])
        } catch (err) {
          logger.error('[dashboard:index.ts] Error in `close` handler', err)
        } finally {
          mainWindow?.destroy()
        }
      }
    })

    mainWindow.on('closed', () => {
      node = null
      firefox = null
      mainWindow = null
    })
  }

  const events = [
    {
      channel: 'firefox:launch',
      listener() {
        firefox!.launch()
        if (!helpers.getIsFirefoxInit()) {
          // firefox!.setDisableScopes(true)
          helpers.setIsFirefoxInit(true)
        }
      },
    },
    {
      channel: 'firefox:status',
      listener(_ev: IpcMainEvent, isRunning: boolean) {
        isFirefoxRunning = isRunning
      },
    },
    {
      channel: 'node:launch',
      listener() {
        node!.launch()
      },
    },
    {
      channel: 'node:launchUninstaller',
      async listener() {
        const confirmationAnswer = dialog.showMessageBoxSync({
          type: 'question',
          title: MESSAGES.uninstallConfirmation.title,
          message: MESSAGES.uninstallConfirmation.message,
          buttons: [
            MESSAGES.uninstallConfirmation.buttons.confirm,
            MESSAGES.uninstallConfirmation.buttons.cancel,
          ],
        })

        if (confirmationAnswer === 0) {
          mainWindow?.webContents.send('dashboard:close')
          logger.info('Closed Dashboard Window')
          events.forEach(event => {
            ipcMain.removeListener(event.channel, event.listener)
            logger.info('[dashboard:index.ts] Removed event', event.channel)
          })

          try {
            await Promise.all([firefox?.close(), Node.stopNode()])
          } catch (err) {
            logger.error('[dashboard:index.ts] Error in `close` handler', err)
          } finally {
            uninstaller!.launch()
            mainWindow?.destroy()
          }
        }
      },
    },
    {
      channel: 'uninstaller:checkUnistaller',
      listener() {
        uninstaller!.checkUninstallerExist()
      },
    },
    {
      channel: 'node:check',
      listener() {
        node!.pointNodeCheck()
      },
    },
    {
      channel: 'sdk:checkUpdate',
      listener() {
        firefox?.checkSDKVersion()
      },
    },
    {
      channel: 'node:download',
      listener() {
        node!.download()
      },
    },
    {
      channel: 'node:checkUpdate',
      listener() {
        node!.checkNodeVersion()
      },
    },
    {
      channel: 'firefox:checkUpdate',
      listener() {
        firefox!.checkFirefoxVersion()
      },
    },
    {
      channel: 'firefox:download',
      listener() {
        console.log('listener firefox!.download() called')
        firefox!.download()
      },
    },
    {
      channel: 'node:getIdentity',
      listener() {
        node!.getIdentity()
      },
    },
    {
      channel: 'dashboard:openDownloadLink',
      listener(event: IpcMainEvent, url: string) {
        try {
          shell.openExternal(url)
        } catch (error) {
          logger.error(error)
        }
      },
    },
    {
      channel: 'dashboard:isNewDashboardReleaseAvailable',
      async listener() {
        mainWindow!.webContents.send(
          'dashboard:isNewDashboardReleaseAvailable',
          await helpers.isNewDashboardReleaseAvailable()
        )
      },
    },
    {
      channel: 'node:getDashboardVersion',
      listener() {
        mainWindow!.webContents.send(
          'node:getDashboardVersion',
          helpers.getInstalledDashboardVersion()
        )
      },
    },
    {
      channel: 'dashboard:getIdentifier',
      listener() {
        mainWindow!.webContents.send(
          'dashboard:getIdentifier',
          getIdentifier()[0]
        )
      },
    },
    {
      channel: 'logOut',
      async listener() {
        const confirmationAnswer = dialog.showMessageBoxSync({
          type: 'question',
          title: MESSAGES.logoutConfirmation.title,
          message: MESSAGES.logoutConfirmation.message,
          buttons: [
            MESSAGES.logoutConfirmation.buttons.confirm,
            MESSAGES.logoutConfirmation.buttons.cancel,
          ],
        })

        if (confirmationAnswer === 0) {
          // User clicked 'Yes' (button at index 0)
          isLoggingOut = true
          await Node.stopNode()
          helpers.logout()
          mainWindow!.close()
        }
      },
    },
    {
      channel: 'node:stop',
      async listener() {
        await Node.stopNode()
      },
    },
    {
      channel: 'node:getVersion',
      async listener(event: IpcMainEvent) {
        event.returnValue = await helpers.getInstalledNodeVersion()
      },
    },
    {
      channel: 'node:check_balance_and_airdrop',
      async listener() {
        // TODO: move this func somewhere to utils
        const delay = (ms: number) =>
          new Promise(resolve => {
            setTimeout(resolve, ms)
          })
        const start = new Date().getTime()
        try {
          let balance = 0
          logger.info('[node:check_balance_and_airdrop] Getting wallet address')
          const addressRes = await axios.get(
            'http://localhost:2468/v1/api/wallet/address'
          )
          const address = addressRes.data.data.address

          const requestAirdrop = async () => {
            logger.info(
              '[node:check_balance_and_airdrop] Airdropping wallet address with POINTS'
            )
            try {
              await axios.get(
                `https://point-faucet.herokuapp.com/airdrop?address=${address}`
              )
            } catch (e) {
              logger.error(e)
            }
          }

          const checkBalance = async () => {
            logger.info(
              `[node:check_balance_and_airdrop] Getting wallet balance for address: ${address}`
            )
            try {
              const res = await axios.get(
                `https://point-faucet.herokuapp.com/balance?address=${address}`
              )
              if (res.data?.balance && !isNaN(res.data.balance)) {
                logger.info(
                  `[node:check_balance_and_airdrop] Balance: ${res.data.balance}`
                )
                balance = res.data.balance
              } else {
                logger.error(`Unexpected balance response: ${res.data}`)
              }
            } catch (e) {
              logger.error(e)
            }
          }

          await checkBalance()

          mainWindow!.webContents.send(
            'node:wallet_info',
            JSON.stringify({ balance, address })
          )
          // eslint-disable-next-line no-unmodified-loop-condition
          while (balance <= 0) {
            if (new Date().getTime() - start > 120000) {
              throw new Error(
                'Could not get positive wallet balance in 2 minutes'
              )
            }
            await requestAirdrop()
            await delay(10000)
            await checkBalance()
          }

          mainWindow!.webContents.send(
            'node:wallet_info',
            JSON.stringify({ balance, address })
          )
        } catch (error) {
          logger.error(error)
        }
      },
    },
    {
      channel: 'dashboard:bounty_request',
      async listener() {
        const fileContents = JSON.parse(
          readFileSync(
            path.join(helpers.getPointPath(), 'infoReferral.json')
          ).toString()
        )
        const referralCode = fileContents.referralCode

        const addressRes = await axios.get(
          'http://localhost:2468/v1/api/wallet/address'
        )
        const address = addressRes.data.data.address

        if (!fileContents.isGeneratedEventSent && address) {
          await axios
            .get(
              `https://bounty.pointnetwork.io/ref_success?event=generated&ref=${referralCode}&addr=${address}`
            )
            .then(res => {
              logger.info(res.data)
              writeFileSync(
                path.join(helpers.getPointPath(), 'infoReferral.json'),
                JSON.stringify({
                  ...fileContents,
                  isGeneratedEventSent: true,
                })
              )
            })
            .catch(logger.error)
        }
      },
    },
    {
      channel: `dashboard:minimizeWindow`,
      listener() {
        mainWindow!.minimize()
      },
    },
    {
      channel: `dashboard:closeWindow`,
      listener() {
        mainWindow!.close()
      },
    },
  ]

  async function registerListeners() {
    events.forEach(event => {
      ipcMain.on(event.channel, event.listener)
      logger.info('[dashboard:index.ts] Registered event', event.channel)
    })
  }

  if (isExplicitRun) {
    createWindow()
    registerListeners()
  }

  app.on('will-quit', async function () {
    // This is a good place to add tests insuring the app is still
    // responsive and all windows are closed.
    logger.info('Dashboard Window "will-quit" event')
  })

  if (!isExplicitRun) {
    app
      .on('ready', createWindow)
      .whenReady()
      .then(registerListeners)
      .catch(e => logger.error(e))

    app.on('window-all-closed', () => {
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  }
}
