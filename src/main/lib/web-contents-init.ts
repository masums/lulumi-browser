import * as path from 'path';
import {
  BrowserView,
  BrowserWindow,
} from 'electron';

import constants from '../constants';

function registerWebContentsEvents(windowId: number, webContents: Electron.WebContents) {
  const browserViewEvents = {
    'did-start-loading': 'onDidStartLoading',
    'load-commit': 'onLoadCommit',
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
    'scroll-touch-begin': 'onScrollTouchBegin',
    'scroll-touch-end': 'onScrollTouchEnd',
    'context-menu': 'onContextMenu',
    'will-navigate': 'onWillNavigate',
    'did-navigate': 'onDidNavigate',
    'did-navigate-in-page': 'onDidNavigateInPage',
  };

  const window = BrowserWindow.fromId(windowId);

  Object.keys(browserViewEvents).forEach((key) => {
    webContents.on((key as any), (event, ...data) => window.webContents.send(key, event, ...data));
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
    if (process.env.TEST_ENV !== 'e2e') {
      webPreferences['contextIsolation'] = true;
    }
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
  window.setBrowserView(view);
  view.setBounds({ x: 0, y: 72, width: bounds[0], height: bounds[1] - 72 });
  webContents.loadURL(url);

  registerWebContentsEvents(windowId, webContents);
  return view.id;
};
