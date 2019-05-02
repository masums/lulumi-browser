import * as path from 'path';
import {
  BrowserView,
  BrowserWindow,
  ipcMain,
} from 'electron';

import constants from '../constants';

function registerWebContentsEvents(
  windowId: number,
  webContents: Electron.WebContents,
  viewId: number) {
  const browserViewEvents = {
    'did-start-loading': 'onDidStartLoading',
    'did-navigate': 'onDidNavigate',
    'page-title-set': 'onPageTitleSet',
    'dom-ready': 'onDomReady',
    'did-frame-finish-load': 'onDidFrameFinishLoad',
    'page-favicon-updated': 'onPageFaviconUpdated',
    'did-stop-loading': 'onDidStopLoading',
    'did-fail-load': 'onDidFailLoad',
    'did-finish-load': 'onDidFinishLoad',
    'ipc-message': 'onIpcMessage',
    'console-message': 'onConsoleMessage',
    'update-target-url': 'onUpdateTargetUrl',
    'media-started-playing': 'onMediaStartedPlaying',
    'media-paused': 'onMediaPaused',
    'enter-html-full-screen': 'onEnterHtmlFullScreen',
    'leave-html-full-screen': 'onLeaveHtmlFullScreen',
    'new-window': 'onNewWindow',
    'context-menu': 'onContextMenu',
    'will-navigate': 'onWillNavigate',
    'did-navigate-in-page': 'onDidNavigateInPage',
  };

  const window = BrowserWindow.fromId(windowId);

  // special case
  webContents.on('new-window', (event: Electron.NewWindowEvent, ...data) => {
    if (data[2] === 'new-window') {
      event.preventDefault();
      (event as any).newGuest = (BrowserWindow as any).createWindow({
        width: 800,
        height: 500,
        // tslint:disable-next-line:align
      }, (eventName) => {
        ipcMain.once(eventName, (event: Electron.Event) => {
          webContents.send(eventName.substr(4), { url: data[0], follow: true });
        });
      });
    } else {
      window.webContents.send('new-window', viewId, ...data);
    }
  });

  Object.keys(browserViewEvents).forEach((key) => {
    webContents.on((key as any), (event, ...data) => {
      window.webContents.send(key, viewId, ...data);
    });
  });
}

export default (windowId: number, url: string): number => {
  const webPreferences: Electron.WebPreferences = {};
  // webPreferences['nativeWindowOpen'] = true;
  webPreferences['enableBlinkFeatures'] = 'OverlayScrollbars';

  const backgroundRegExp = new RegExp('^lulumi-extension://.+/\.*background\.*.html$');
  if (url.startsWith('lulumi-extension://')) {
    if (url.match(backgroundRegExp)) {
      webPreferences['preload'] = path.join(constants.lulumiPreloadPath, 'extension-preload.js');
    } else {
      webPreferences['preload'] = path.join(constants.lulumiPreloadPath, 'popup-preload.js');
    }
  } else {
    webPreferences['contextIsolation'] = true;
    webPreferences['preload'] = path.join(constants.lulumiPreloadPath, 'webview-preload.js');
    webPreferences['partition'] = 'persist:webview';
    webPreferences['plugins'] = true;
  }

  const window = BrowserWindow.fromId(windowId);
  const bounds = window.getSize();
  const view = new BrowserView({
    webPreferences,
  });
  const webContents = view.webContents;
  view.setBackgroundColor('#ececec');
  view.setBounds({ x: 0, y: 72, width: bounds[0], height: bounds[1] - 72 });
  webContents.loadURL(url);

  registerWebContentsEvents(windowId, webContents, view.id);
  return view.id;
};
