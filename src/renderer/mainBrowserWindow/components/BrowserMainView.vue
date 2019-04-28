<template lang="pug">
div
  #nav(ref="nav")
    tabs(ref="tabs", :windowId="windowId")
    navbar(ref="navbar", :windowId="windowId")
  swipeArrow
  tab(v-for="(tab, index) in tabs",
      :isActive="index === currentTabIndex",
      :windowId="windowId",
      :windowWebContentsId="windowWebContentsId",
      :tabIndex="index",
      :tabId="tab.id",
      :ref="`tab-${index}`",
      :key="`tab-${tab.id}`")
  #footer
    transition(name="extend")
      .browser-tab-status(v-show="tab.statusText") {{ decodeURIComponent(tab.statusText) }}
    download(v-show="$store.getters.downloads.length !== 0 && showDownloadBar")
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

import * as path from 'path';
import * as urlPackage from 'url';

import Tabs from './BrowserMainView/Tabs.vue';
import Navbar from './BrowserMainView/Navbar.vue';
import swipeArrow from './BrowserMainView/SwipeArrow.vue';
import Tab from './BrowserMainView/Tab.vue';
import Download from './BrowserMainView/Download.vue';

import { is } from 'electron-util';
import urlUtil from '../../lib/url-util';
import imageUtil from '../../lib/image-util';
import urlResource from '../../lib/url-resource';

import ExtensionService from '../../api/extension-service';
import Event from '../../api/event';

@Component({
  name: 'browser-main',
  components: {
    Tabs,
    Navbar,
    swipeArrow,
    Tab,
    Download,
  },
})
export default class BrowserMainView extends Vue {
  windowId: number = 0;
  windowWebContentsId: number = 0;
  htmlFullscreen: boolean = false;
  trackingFingers: boolean = false;
  swipeGesture: boolean = false;
  isSwipeOnEdge: boolean = false;
  deltaX: number = 0;
  deltaY: number = 0;
  hnorm: number = 0;
  startTime: number = 0;
  showDownloadBar: boolean = false;
  extensionService: ExtensionService;
  contextMenus: object = {};
  onCommandEvent: Event = new Event();
  onUpdatedEvent: Event = new Event();
  onCreatedEvent: Event = new Event();
  onRemovedEvent: Event = new Event();
  alarms: Lulumi.BrowserMainView.AlarmArray = {};
  onActivatedEvent: Event = new Event();
  onAlarmEvent: Event = new Event();
  onBeforeNavigate: Event = new Event();
  onCreatedNavigationTarget: Event = new Event();
  onCommitted: Event = new Event();
  onCompleted: Event = new Event();
  onDOMContentLoaded: Event = new Event();

  get dummyTabObject(): Lulumi.Store.TabObject {
    return this.$store.getters.tabConfig.dummyTabObject;
  }
  get window(): Lulumi.Store.LulumiBrowserWindowProperty {
    return this.$store.getters.windows.find(window => window.id === this.windowId);
  }
  get currentTabIndex(): number | undefined {
    return this.$store.getters.currentTabIndexes[this.windowId];
  }
  get tabs(): Lulumi.Store.TabObject[] {
    return this.$store.getters.tabs.filter(tab => tab.windowId === this.windowId);
  }
  get tab(): Lulumi.Store.TabObject {
    if (this.tabs.length === 0 || this.currentTabIndex === undefined) {
      return this.dummyTabObject;
    }
    return this.tabs[this.currentTabIndex];
  }
  get tabsOrder(): number[] {
    return this.$store.getters.tabsOrder[this.windowId];
  }
  get homepage(): string {
    return this.$store.getters.homepage;
  }
  get pdfViewer(): string {
    return this.$store.getters.pdfViewer;
  }
  get certificates(): Lulumi.Store.Certificates {
    return this.$store.getters.certificates;
  }
  get historyMenuItem(): Electron.MenuItemConstructorOptions[] {
    const recentlyClosed: any[] = [];
    this.lastOpenedTabs().forEach((lastOpenedTab) => {
      recentlyClosed.push(
        {
          label: lastOpenedTab.title,
          click: () => this.onNewTab(this.windowId, lastOpenedTab.url, true),
          mtime: lastOpenedTab.mtime,
        },
      );
    });
    const windowProperties: any = this.$electron.ipcRenderer.sendSync('get-window-properties');
    windowProperties.forEach((windowProperty) => {
      recentlyClosed.push(
        {
          label: this.$t(
            'navbar.common.options.history.tabs',{ amount: windowProperty.amount }) as string,
          click: () => this.$electron.ipcRenderer
            .send('restore-window-property', windowProperty),
          mtime: windowProperty.mtime,
        },
      );
    });
    recentlyClosed.sort((a, b) => (b.mtime - a.mtime))
      .map(m => delete m.mtime);
    if (recentlyClosed[0] !== undefined) {
      recentlyClosed[0].accelerator = 'CmdOrCtrl+Shift+T';
    }
    return recentlyClosed;
  }

  getInfoFromBrowserViewId(viewId: number): [number, number] {
    const tabIndex = this.tabs.findIndex(tab => tab.viewId === viewId);
    return [tabIndex, this.tabs[tabIndex].id];
  }
  getBrowserViewFromWebContents(webContents: Electron.WebContents): Electron.BrowserView | null {
    return this.$electron.remote.BrowserView.fromWebContents(webContents);
  }
  getBrowserView(tabIndex?: number): Electron.BrowserView {
    let index: number | undefined = tabIndex;
    if (index === undefined) {
      if (this.currentTabIndex === undefined) {
        index = 0;
      } else {
        index = this.currentTabIndex;
      }
    }
    return this.$electron.remote.BrowserView.fromId(this.$refs[`tab-${index}`][0].viewId);
  }
  getTab(tabIndex?: number): Tab {
    let index: number | undefined = tabIndex;
    if (index === undefined) {
      if (this.currentTabIndex === undefined) {
        index = 0;
      } else {
        index = this.currentTabIndex;
      }
    }
    return this.$refs[`tab-${index}`][0];
  }
  getTabObject(tabIndex?: number): Lulumi.Store.TabObject {
    let index: number | undefined = tabIndex;
    if (index === undefined) {
      if (this.currentTabIndex === undefined) {
        index = 0;
      } else {
        index = this.currentTabIndex;
      }
    }
    return this.tabs[index];
  }
  async historyMappings() {
    const out: any = {};
    this.$store.getters.history.forEach((h) => {
      if (!out[h.url]) {
        out[h.url] = {
          title: h.title,
          icon: h.favIconUrl,
        };
      }
    });
    return out;
  }
  lastOpenedTabs(): Lulumi.Store.LastOpenedTabObject[] {
    const lastOpenedTabs: Lulumi.Store.LastOpenedTabObject[]
      = this.$store.getters.lastOpenedTabs.slice(0, 8);
    // clone every tab so that we won't modify the vuex object directly
    lastOpenedTabs.map((tab, index) => (lastOpenedTabs[index] = Object.assign({}, tab)));
    lastOpenedTabs.forEach((lastOpenedTab) => {
      switch (lastOpenedTab.title) {
        case 'about:about':
          lastOpenedTab.title = this.$t('lulumi.aboutPage.title');
          break;
        case 'about:lulumi':
          lastOpenedTab.title = this.$t('lulumi.lulumiPage.title');
          break;
        case 'about:preferences/search':
          lastOpenedTab.title = this.$t('lulumi.preferencesPage.searchEngineProviderPage.title');
          break;
        case 'about:preferences/homepage':
          lastOpenedTab.title = this.$t('lulumi.preferencesPage.homePage.title');
          break;
        case 'about:preferences/pdfViewer':
          lastOpenedTab.title = this.$t('lulumi.preferencesPage.pdfViewerPage.title');
          break;
        case 'about:preferences/tab':
          lastOpenedTab.title = this.$t('lulumi.preferencesPage.tabConfigPage.title');
          break;
        case 'about:preferences/language':
          lastOpenedTab.title = this.$t('lulumi.preferencesPage.LanguagePage.title');
          break;
        case 'about:downloads':
          lastOpenedTab.title = this.$t('lulumi.downloadsPage.title');
          break;
        case 'about:history':
          lastOpenedTab.title = this.$t('lulumi.historyPage.title');
          break;
        case 'about:extensions':
          lastOpenedTab.title = this.$t('lulumi.extensionsPage.title');
          break;
        case 'about:newtab':
          lastOpenedTab.title = this.$t('lulumi.newtabPage.title');
          break;
      }
    });
    return lastOpenedTabs;
  }
  // lulumi.alarms
  getAlarm(name): Lulumi.BrowserMainView.Alarm | undefined {
    return this.alarms[name];
  }
  getAllAlarm(): Lulumi.BrowserMainView.AlarmArray {
    return this.alarms;
  }
  clearAlarm(name: string): boolean {
    const alarm = this.getAlarm(name);
    if (alarm) {
      if (alarm.handler) {
        if (alarm.periodInMinutes) {
          clearInterval(alarm.handler);
        } else {
          clearTimeout(alarm.handler);
        }
      }
      Vue.delete(this.alarms, name);
      return true;
    }
    return false;
  }
  clearAllAlarm(): boolean {
    return Object.keys(this.getAllAlarm()).every(name => (this.clearAlarm(name)));
  }
  createAlarm(name: string, alarmInfo): void {
    const alarm: Lulumi.BrowserMainView.Alarm = {
      handler: () => {},
    };
    let timeout: number = 0;

    this.clearAlarm(name);

    if (alarmInfo.when) {
      timeout = alarmInfo.when - Date.now();
    } else if (alarmInfo.delayInMinutes) {
      timeout = alarmInfo.delayInMinutes * 60 * 1000;
    } else if (alarmInfo.periodInMinutes) {
      timeout = alarmInfo.periodInMinutes * 60 * 1000;
    }
    if (timeout !== 0) {
      alarm.handler
        = setTimeout(() => this.onAlarmEvent.emit(this.getAlarm(name)), timeout);
      if (alarmInfo.periodInMinutes) {
        timeout = alarmInfo.periodInMinutes * 60 * 1000;
        alarm.handler
          = setInterval(() => this.onAlarmEvent.emit(this.getAlarm(name)), timeout);
        alarm.periodInMinutes = alarmInfo.periodInMinutes;
      }

      Vue.set(this.alarms, name, alarm);
    }
  }
  addContextMenus(menuItems, webContentsId: number): void {
    if (menuItems) {
      if (menuItems.length === 0) {
        Vue.delete((this.contextMenus as any), webContentsId);
      } else {
        this.contextMenus[`'${webContentsId}'`] = [menuItems];
      }
    }
  }
  // tabHandlers
  onDidStartLoading(viewId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    this.$store.dispatch('didStartLoading', {
      tabId,
      tabIndex,
      url: webContents.getURL(),
      webContentsId: webContents.id,
      windowId: this.windowId,
    });
    if (!(process.env.NODE_ENV === 'test'
      && process.env.TEST_ENV === 'unit')) {
      this.onUpdatedEvent.emit(
        tabId,
        {
          url: webContents.getURL(),
        },
        this.getTabObject(tabIndex));
    }
    this.onCommitted.emit({
      frameId: 0,
      parentFrameId: -1,
      processId: webContents.getOSProcessId(),
      tabId: this.getTabObject(tabIndex).id,
      timeStamp: Date.now(),
      url: webContents.getURL(),
    });
  }
  onLoadCommit(viewId: number, url: string, isMainFrame: boolean): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    if (isMainFrame) {
      this.$store.dispatch('loadCommit', {
        tabId,
        tabIndex,
        windowId: this.windowId,
      });
    }
  }
  onDomReady(viewId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    const url = webContents.getURL();
    const parsedURL = urlPackage.parse(url, true);

    this.$electron.ipcRenderer.send('set-browser-window-title', {
      title: webContents.getTitle(),
      windowId: this.windowId,
    });
    this.$store.dispatch('pageTitleSet', {
      tabId,
      tabIndex,
      title: webContents.getTitle(),
      windowId: this.windowId,
    });

    if (parsedURL.protocol === 'chrome:' && parsedURL.hostname === 'pdf-viewer') {
      if (this.pdfViewer === 'pdf-viewer') {
        this.$store.dispatch('domReady', {
          tabId,
          tabIndex,
          canGoBack: webContents.canGoBack(),
          canGoForward: webContents.canGoForward(),
          windowId: this.windowId,
        });
      } else {
        webContents.downloadURL(parsedURL.query.src as string);
      }
    } else {
      this.$store.dispatch('domReady', {
        tabId,
        tabIndex,
        canGoBack: webContents.canGoBack(),
        canGoForward: webContents.canGoForward(),
        windowId: this.windowId,
      });
    }
    this.onDOMContentLoaded.emit({
      url,
      frameId: 0,
      parentFrameId: -1,
      processId: webContents.getOSProcessId(),
      tabId: this.getTabObject(tabIndex).id,
      timeStamp: Date.now(),
    });
    if (!(process.env.NODE_ENV === 'test'
      && process.env.TEST_ENV === 'unit')) {
      this.onUpdatedEvent.emit(
        tabId,
        {
          title: webContents.getTitle(),
        },
        this.getTabObject(tabIndex));
    }
  }
  onDidFrameFinishLoad(viewId: number, isMainFrame: boolean): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    if (isMainFrame) {
      this.$store.dispatch('didFrameFinishLoad', {
        tabId,
        tabIndex,
        url: webContents.getURL(),
        canGoBack: webContents.canGoBack(),
        canGoForward: webContents.canGoForward(),
        windowId: this.windowId,
      });
    }
  }
  onPageFaviconUpdated(viewId: number, favicons: string[]): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    this.$store.dispatch('pageFaviconUpdated', {
      tabId,
      tabIndex,
      url: favicons[0],
      windowId: this.windowId,
    });
    if (!(process.env.NODE_ENV === 'test'
      && process.env.TEST_ENV === 'unit')) {
      this.onUpdatedEvent.emit(
        tabId,
        {
          favIconUrl: favicons[0],
        },
        this.getTabObject(tabIndex));
    }
  }
  onDidStopLoading(viewId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    this.$store.dispatch('didStopLoading', {
      tabId,
      tabIndex,
      url: webContents.getURL(),
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      windowId: this.windowId,
    });
  }
  onDidFailLoad(
    viewId: number,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    this.$store.dispatch('didFailLoad', {
      tabId,
      tabIndex,
      isMainFrame,
      windowId: this.windowId,
    });
    const appPath = process.env.NODE_ENV === 'development'
      ? path.join(process.cwd(), 'src/helper')
      : path.join(this.$electron.remote.app.getAppPath(), 'dist');
    let ec = errorCode;
    let errorPage = `file://${appPath}/pages/error/index.html`;

    if (ec === -501) {
      const hostname = urlUtil.getHostname(validatedURL);
      if (hostname) {
        const certificateObject = this.certificates[hostname];
        if (certificateObject) {
          ec = certificateObject.errorCode;
        }
      }
    }
    errorPage += `?ec=${encodeURIComponent(ec.toString())}`;
    errorPage += `&url=${encodeURIComponent(webContents.getURL())}`;
    if (ec !== -3 && validatedURL === webContents.getURL()) {
      this.getTab(tabIndex).navigateTo(
        `${errorPage}`);
    }
  }
  onIpcMessage(viewId: number, channel: string): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.$electron.remote.BrowserView.fromId(viewId).webContents;
    if (channel === 'newtab') {
      const navbar = (this.$refs.navbar as Navbar);
      if (this.extensionService.newtabOverrides !== '') {
        webContents.send('newtab', this.extensionService.newtabOverrides);
      } else {
        webContents.send('newtab', '');
        navbar.showUrl(this.getTabObject(tabIndex).url, tabId);
      }
    }
  }
  onUpdateTargetUrl(viewId: number, url: string): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    this.$store.dispatch('updateTargetUrl', {
      tabId,
      tabIndex,
      url,
      windowId: this.windowId,
    });
  }
  onMediaStartedPlaying(viewId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    this.$store.dispatch('mediaStartedPlaying', {
      tabId,
      tabIndex,
      isAudioMuted: webContents.isAudioMuted(),
      windowId: this.windowId,
    });
  }
  onMediaPaused(viewId: number): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    this.$store.dispatch('mediaPaused', {
      tabId,
      tabIndex,
      windowId: this.windowId,
    });
  }
  onToggleAudio(event: Electron.Event, tabIndex: number, muted: boolean): void {
    const webContents = this.getBrowserView(tabIndex).webContents;
    const tabObject = this.getTabObject(tabIndex);
    webContents.setAudioMuted(muted);
    this.$store.dispatch('toggleAudio', {
      tabIndex,
      muted,
      tabId: tabObject.id,
      windowId: this.windowId,
    });
    if (!(process.env.NODE_ENV === 'test'
      && process.env.TEST_ENV === 'unit')) {
      this.onUpdatedEvent.emit(
        tabObject.id,
        {
          mutedInfo: { muted },
        },
        tabObject);
    }
  }
  onEnterHtmlFullScreen(): void {
    this.$electron.remote.BrowserWindow.fromId(this.windowId).setFullScreen(true);
    this.htmlFullscreen = true;
  }
  onLeaveHtmlFullScreen(): void {
    if (this.htmlFullscreen) {
      this.htmlFullscreen = false;
      const webContents = this.getBrowserView().webContents;
      const nav = this.$el.querySelector('#nav') as HTMLDivElement;
      if (nav) {
        nav.style.display = 'block';
        // this.getBrowserView().style.height = `calc(100vh - ${nav.clientHeight}px)`;
        const jsScript = 'document.webkitExitFullscreen()';
        webContents.executeJavaScript(jsScript, true);
      }
      this.$electron.remote.BrowserWindow.fromId(this.windowId).setFullScreen(false);
      if (is.macos) {
        this.$electron.remote.BrowserWindow.fromId(this.windowId).setSimpleFullScreen(false);
      }
    }
  }
  onNewWindow(
    viewId: number,
    url: string,
    frameName: string,
    disposition: string,
    options: any,
    additionalFeatures: string[],
    referrer: Electron.Referrer): void {
    if (disposition === 'foreground-tab') {
      this.onNewTab(this.windowId, url, true);
    } else if (disposition === 'background-tab') {
      this.onNewTab(this.windowId, url, false);
    } else {
      // tslint:disable-next-line
      console.log(`NOTIMPLEMENTED: ${disposition}`);
    }
    /*
    this.onCreatedNavigationTarget.emit({
      url,
      sourceTabId: this.getTabObject(tabIndex).id,
      sourceProcessId: this.getBrowserView(tabIndex).getWebContents().getOSProcessId(),
      sourceFrameId: 0,
      timeStamp: Date.now(),
      tabId: this.$store.getters.pid,
    });
    */
  }
  onWheel(event: WheelEvent): void {
    const leftSwipeArrow = document.getElementById('left-swipe-arrow');
    const rightSwipeArrow = document.getElementById('right-swipe-arrow');

    const SWIPE_TRIGGER_DIST = 200;
    const ARROW_OFF_DIST = 200;

    if (leftSwipeArrow !== null && rightSwipeArrow !== null) {
      if (this.trackingFingers) {
        const webContents = this.getBrowserView().webContents;

        this.deltaX += event.deltaX;
        this.deltaY += event.deltaY;

        if (Math.abs(this.deltaY) > Math.abs(this.deltaX)) {
          this.hnorm = 0;
        } else if ((this.deltaX < 0 && !webContents.canGoBack())
          || (this.deltaX > 0 && !webContents.canGoForward())) {
          this.hnorm = 0;
          this.deltaX = 0;
        } else {
          this.hnorm = this.deltaX / SWIPE_TRIGGER_DIST;
        }
        this.hnorm = Math.min(1.0, Math.max(-1.0, this.hnorm));

        if (this.deltaX < 0) {
          leftSwipeArrow.style.left
            = `${((-1 * ARROW_OFF_DIST) - (this.hnorm * ARROW_OFF_DIST))}px`;
          rightSwipeArrow.style.right = `${(-1 * ARROW_OFF_DIST)}px`;
        }
        if (this.deltaX > 0) {
          leftSwipeArrow.style.left = `${(-1 * ARROW_OFF_DIST)}px`;
          rightSwipeArrow.style.right
            = `${((-1 * ARROW_OFF_DIST) + (this.hnorm * ARROW_OFF_DIST))}px`;
        }

        if (this.hnorm <= -1) {
          leftSwipeArrow.classList.add('highlight');
        } else {
          leftSwipeArrow.classList.remove('highlight');
        }
        if (this.hnorm >= 1) {
          rightSwipeArrow.classList.add('highlight');
        } else {
          rightSwipeArrow.classList.remove('highlight');
        }
      }
    }
  }
  onOpenPDF(event: Electron.Event, data): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(data.webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        if (this.pdfViewer === 'pdf-viewer') {
          const parsedURL = urlPackage.parse(data.url, true);
          webContents.downloadURL(`${parsedURL.query.file}?skip=true`);
        } else {
          webContents.loadURL(data.url);
        }
      }
    }
  }
  onWillDownloadAnyFile(event: Electron.Event, data): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(data.webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        this.showDownloadBar = true;
        this.$store.dispatch('createDownloadTask', {
          name: data.name,
          url: data.url,
          totalBytes: data.totalBytes,
          isPaused: data.isPaused,
          canResume: data.canResume,
          startTime: data.startTime,
          getReceivedBytes: 0,
          dataState: data.dataState,
          style: '',
        });
      }
    }
  }
  onUpdateDownloadsProgress(event: Electron.Event, data): void {
    if (data.hostWebContentsId === this.windowWebContentsId) {
      this.$store.dispatch('updateDownloadsProgress', {
        startTime: data.startTime,
        getReceivedBytes: data.getReceivedBytes,
        savePath: data.savePath,
        isPaused: data.isPaused,
        canResume: data.canResume,
        dataState: data.dataState,
      });
    }
  }
  onCompleteDownloadsProgress(event: Electron.Event, data): void {
    if (data.hostWebContentsId === this.windowWebContentsId) {
      this.$store.dispatch('completeDownloadsProgress', {
        name: data.name,
        startTime: data.startTime,
        dataState: data.dataState,
      });
      const download =
        this.$store.getters.downloads.filter(download => download.startTime === data.startTime);
      if (download.length) {
        let option: any;
        if (data.dataState === 'completed') {
          option = {
            title: 'Success',
            body: `${data.name} download successfully!`,
          };
        } else if (data.dataState === 'cancelled') {
          option = {
            title: 'Cancelled',
            body: `${data.name} has been cancelled!`,
          };
        } else {
          option = {
            title: 'Success',
            body: `${data.name} download successfully!`,
          };
        }
        new Notification(option.title, option);
      } else {
        this.showDownloadBar
          = this.$store.getters.downloads.every(download => download.style === 'hidden')
            ? false
            : this.showDownloadBar;
      }
    }
  }
  onCloseDownloadBar(): void {
    this.showDownloadBar = false;
    this.$store.dispatch('closeDownloadBar');
  }
  onScrollTouchBegin(event: Electron.Event, swipeGesture: boolean): void {
    if (swipeGesture) {
      this.trackingFingers = true;
      this.isSwipeOnEdge = false;
    }
  }
  onScrollTouchEnd(): void {
    const leftSwipeArrow = document.getElementById('left-swipe-arrow');
    const rightSwipeArrow = document.getElementById('right-swipe-arrow');

    const ARROW_OFF_DIST = 200;

    if (leftSwipeArrow !== null && rightSwipeArrow !== null) {
      if (this.trackingFingers && this.isSwipeOnEdge) {
        const webContents = this.getBrowserView().webContents;

        if (this.hnorm <= -1) {
          webContents.goBack();
        }
        if (this.hnorm >= 1) {
          webContents.goForward();
        }
      }
      leftSwipeArrow.classList.add('returning');
      leftSwipeArrow.classList.remove('highlight');
      leftSwipeArrow.style.left = `${(-1 * ARROW_OFF_DIST)}px`;
      rightSwipeArrow.classList.add('returning');
      rightSwipeArrow.classList.remove('highlight');
      rightSwipeArrow.style.right = `${(-1 * ARROW_OFF_DIST)}px`;

      this.trackingFingers = false;
      this.deltaX = 0;
      this.deltaY = 0;
      this.hnorm = 0;
    }
  }
  onScrollTouchEdge(): void {
    this.isSwipeOnEdge = true;
  }
  onEnterFullscreen(isDarwin: boolean): void {
    document.body.classList.add('fullscreen');
    const nav = this.$el.querySelector('#nav') as HTMLDivElement;
    if (nav) {
      nav.style.display = 'none';
      // this.getBrowserView().style.height = '100vh';
    }
  }
  onLeaveFullscreen(isDarwin: boolean): void {
    document.body.classList.remove('fullscreen');
    const nav = this.$el.querySelector('#nav') as HTMLDivElement;
    if (nav) {
      nav.style.display = 'block';
      // this.getBrowserView().style.height = `calc(100vh - ${nav.clientHeight}px)`;
    }
    if (this.htmlFullscreen) {
      this.onLeaveHtmlFullScreen();
    } else if (this.$electron.remote.BrowserWindow.fromId(this.windowId).isFullScreen()) {
      this.$electron.remote.BrowserWindow.fromId(this.windowId).setFullScreen(false);
    }
  }
  onContextMenu(viewId: number, params: Electron.ContextMenuParams): void {
    this.onWebviewContextMenu(params);
  }
  onWillNavigate(viewId: number, url: string): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    this.$store.dispatch('clearPageAction', {
      tabId,
      tabIndex,
      windowId: this.windowId,
    });
    this.getTab(tabIndex).onMessageEvent.listeners = [];
    this.onBeforeNavigate.emit({
      url,
      tabId: this.getTabObject(tabIndex).id,
      frameId: 0,
      parentFrameId: -1,
      timeStamp: Date.now(),
    });
  }
  onDidNavigate(
    viewId: number,
    url: string,
    httpResponseCode: number,
    httpStatusText: string): void {
    const [tabIndex, tabId] = this.getInfoFromBrowserViewId(viewId);
    const webContents = this.getBrowserView(tabIndex).webContents;
    this.onCompleted.emit({
      url,
      tabId,
      frameId: 0,
      parentFrameId: -1,
      processId: webContents.getOSProcessId(),
      timeStamp: Date.now(),
    });
  }
  onGetSearchEngineProvider(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', {
          searchEngine: this.$store.getters.searchEngine,
          currentSearchEngine: this.$store.getters.currentSearchEngine,
          autoFetch: this.$store.getters.autoFetch,
        });
      }
    }
  }
  onGetHomepage(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', {
          homepage: this.$store.getters.homepage,
        });
      }
    }
  }
  onGetPDFViewer(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', {
          pdfViewer: this.$store.getters.pdfViewer,
        });
      }
    }
  }
  onGetTabConfig(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', this.$store.getters.tabConfig);
      }
    }
  }
  onGetLang(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', {
          lang: this.$store.getters.lang,
        });
      }
    }
  }
  onGetProxyConfig(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    if (webContents && webContents.hostWebContents.id === this.windowWebContentsId) {
      webContents.send('guest-here-your-data', this.$store.getters.proxyConfig);
    }
  }
  onGetAuth(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    if (webContents && webContents.hostWebContents.id === this.windowWebContentsId) {
      webContents.send('guest-here-your-data', this.$store.getters.auth);
    }
  }
  onGetDownloads(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', this.$store.getters.downloads);
      }
    }
  }
  onGetHistory(event: Electron.Event, webContentsId: number): void {
    const webContents: Electron.webContents | null
      = this.$electron.remote.webContents.fromId(webContentsId);
    const browserView = this.getBrowserViewFromWebContents(webContents);
    if (webContents && browserView) {
      const browserWindow = this.$electron.remote.BrowserWindow.fromBrowserView(browserView);
      if (browserWindow && browserWindow.webContents.id === this.windowWebContentsId) {
        webContents.send('guest-here-your-data', this.$store.getters.history);
      }
    }
  }
  // tabHandlers
  onNewTab(windowId: number = this.windowId, url: string, follow: boolean = false): void {
    this.$store.dispatch('incrementTabId');
    if (url) {
      if (url.startsWith('about:')) {
        this.$store.dispatch('createTab', {
          windowId,
          isURL: true,
          follow: true,
          url: urlResource.aboutUrls(url),
        });
        this.$electron.ipcRenderer.send('focus-window', this.windowId);
      } else {
        this.$store.dispatch('createTab', {
          windowId,
          url,
          follow,
          isURL: urlUtil.isURL(url),
        });
      }
    }
    setTimeout(
      () => {
        this.$store.dispatch('setTabsOrder', {
          windowId: this.windowId,
          tabsOrder: (this.$refs.tabs as Tabs).sortable.toArray(),
        });
        if (!(process.env.NODE_ENV === 'test'
        && process.env.TEST_ENV === 'unit')) {
          this.onCreatedEvent.emit(this.getTabObject(this.currentTabIndex));
        }
      },
      300);
  }
  onTabDuplicate(tabIndex: number): void {
    const tabObject: Lulumi.Store.TabObject = this.getTabObject(tabIndex);
    if (tabObject) {
      this.onNewTab(this.windowId, tabObject.url, true);
    }
  }
  onTabClick(tabIndex: number): void {
    let usedTabIndex = tabIndex;
    if (usedTabIndex === -1) {
      usedTabIndex = this.tabs.length - 1;
    }
    const tabObject: Lulumi.Store.TabObject = this.getTabObject(usedTabIndex);
    if (tabObject) {
      const tabId: number = tabObject.id;
      const tabTitle: string | null = tabObject.title;
      this.$store.dispatch('clickTab', {
        tabId,
        tabIndex: usedTabIndex,
        windowId: this.windowId,
      });
      if (tabTitle) {
        this.$electron.ipcRenderer.send('set-browser-window-title', {
          windowId: this.windowId,
          title: tabTitle,
        });
      }
    }
  }
  onTabClose(tabIndex: number): void {
    let usedTabIndex = tabIndex;
    if (usedTabIndex === -1) {
      usedTabIndex = this.tabs.length - 1;
    }
    const tabObject: Lulumi.Store.TabObject = this.getTabObject(usedTabIndex);
    if (tabObject) {
      const tabId: number = tabObject.id;
      this.onRemovedEvent.emit(tabObject);
      this.$store.dispatch('closeTab', {
        tabId,
        tabIndex: usedTabIndex,
        windowId: this.windowId,
      });
      setTimeout(
        () => this.$store.dispatch(
          'setTabsOrder',
          {
            windowId: this.windowId,
            tabsOrder: (this.$refs.tabs as Tabs).sortable.toArray(),
          }),
        300);
    }
  }
  // navHandlers
  onClickHome(): void {
    this.getTab().navigateTo(this.homepage);
  }
  onClickBack(): void {
    const webContents = this.getBrowserView().webContents;
    if (this.getTabObject().error) {
      webContents.goToOffset(-2);
    } else {
      webContents.goBack();
    }
  }
  onClickForward(): void {
    const webContents = this.getBrowserView().webContents;
    webContents.goForward();
  }
  onClickStop(): void {
    const webContents = this.getBrowserView().webContents;
    webContents.stop();
  }
  onClickRefresh(): void {
    const webContents = this.getBrowserView().webContents;
    const url = urlUtil.getUrlIfError(this.tab.url);
    if (webContents.getURL() === url) {
      webContents.reload();
    } else {
      webContents.loadURL(url);
    }
  }
  onClickForceRefresh(): void {
    const webContents = this.getBrowserView().webContents;
    const url = urlUtil.getUrlIfError(this.tab.url);
    if (webContents.getURL() === url) {
      webContents.reloadIgnoringCache();
    } else {
      webContents.loadURL(url);
    }
  }
  onClickViewSource(): void {
    const webContents = this.getBrowserView().webContents;
    const url = urlUtil.getUrlIfError(this.tab.url);
    if (webContents.getURL() === url) {
      const sourceUrl = urlUtil.getViewSourceUrlFromUrl(url);
      if (sourceUrl !== null) {
        this.onNewTab(this.windowId, sourceUrl, true);
      }
    }
  }
  onClickToggleDevTools(): void {
    const webContents = this.getBrowserView().webContents;
    const url = urlUtil.getUrlIfError(this.tab.url);
    if (webContents.getURL() === url) {
      webContents.openDevTools({ mode: 'bottom' });
    }
  }
  onClickJavaScriptPanel(): void {
    const webContents = this.getBrowserView().webContents;
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
    } else {
      webContents.once('devtools-opened', () => {
        const dtwc = webContents.devToolsWebContents;
        if (dtwc) {
          dtwc.executeJavaScript('DevToolsAPI.showPanel("console")');
        }
      });
      webContents.openDevTools();
    }
  }
  onEnterUrl(url: string): void {
    let newUrl: string;
    if (url.startsWith('about:')) {
      newUrl = urlResource.aboutUrls(url);
    } else if (urlUtil.isNotURL(url)) {
      newUrl = this.$store.getters.currentSearchEngine.search.replace('{queryString}', url);
    } else {
      newUrl = url;
    }
    this.getTab().navigateTo(newUrl);
  }
  // onTabContextMenu
  onTabContextMenu(event: Electron.Event, tabIndex: number): void {
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();

      menu.append(new MenuItem({
        label: this.$t('tabs.contextMenu.newTab') as string,
        click: () => this.onNewTab(this.windowId, 'about:newtab', false),
      }));
      menu.append(new MenuItem({
        label: this.$t('tabs.contextMenu.duplicateTab') as string,
        click: () => {
          this.onTabDuplicate(tabIndex);
        },
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: this.$t('tabs.contextMenu.closeTab') as string,
        click: () => {
          this.onTabClose(tabIndex);
        },
      }));

      menu.popup({ window: currentWindow });
    }
  }
  // onClickBackContextMenu
  async onClickBackContextMenu(): Promise<void> {
    /*
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();
      const webContents = this.getBrowserView().webContents;
      const navbar = document.getElementById('browser-navbar');
      const goBack = document.getElementById('browser-navbar__goBack');

      const current = webContents.getActiveIndex();
      const urls = webContents.history;

      const history = await this.historyMappings();

      if (goBack !== null && navbar !== null) {
        if (current <= urls.length - 1 && current !== 0) {
          for (let i = current - 1; i >= 0; i = i-1) {
            try {
              menu.append(new MenuItem({
                label: history[urls[i]].title,
                click: () => webContents.goToIndex(i),
              }));
            } catch (e) {
              menu.append(new MenuItem({
                label: urls[i],
                click: () => webContents.goToIndex(i),
              }));
            }
          }

          menu.append(new MenuItem({ type: 'separator' }));
          menu.append(new MenuItem({
            label: this.$t('navbar.navigator.history') as string,
            click: () => this.onNewTab(this.windowId, 'about:history', false),
          }));

          menu.popup({
            window: currentWindow,
            x: Math.floor(goBack.getBoundingClientRect().left),
            y: Math.floor(navbar.getBoundingClientRect().bottom),
          });
        }
      }
    }
    */
  }
  // onClickForwardContextMenu
  async onClickForwardContextMenu(): Promise<void> {
    /*
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();
      const webContents = this.getBrowserView().webContents;
      const navbar = document.getElementById('browser-navbar');
      const goForward = document.getElementById('browser-navbar__goForward');

      const current = webContents.getActiveIndex();
      const urls = webContents.history;

      const history = await this.historyMappings();

      if (goForward !== null && navbar !== null) {
        if (current <= urls.length - 1 && current !== urls.length - 1) {
          for (let i = current + 1; i < urls.length; i = i+1) {
            try {
              menu.append(new MenuItem({
                label: history[urls[i]].title,
                click: () => webContents.goToIndex(i),
              }));
            } catch (e) {
              menu.append(new MenuItem({
                label: urls[i],
                click: () => webContents.goToIndex(i),
              }));
            }
          }

          menu.append(new MenuItem({ type: 'separator' }));
          menu.append(new MenuItem({
            label: this.$t('navbar.navigator.history') as string,
            click: () => this.onNewTab(this.windowId, 'about:history', false),
          }));

          menu.popup({
            window: currentWindow,
            x: Math.floor(goForward.getBoundingClientRect().left),
            y: Math.floor(navbar.getBoundingClientRect().bottom),
          });
        }
      }
    }
    */
  }
  // onNavContextMenu
  onNavContextMenu(event: Electron.Event): void {
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();
      const clipboard = this.$electron.clipboard;

      menu.append(new MenuItem({
        label: this.$t('navbar.contextMenu.cut') as string,
        role: 'cut',
      }));
      menu.append(new MenuItem({
        label: this.$t('navbar.contextMenu.copy') as string,
        click: () => {
          if (event.target) {
            clipboard.writeText((event.target as HTMLInputElement).value);
          }
        },
      }));
      menu.append(new MenuItem({
        label: this.$t('navbar.contextMenu.paste') as string,
        role: 'paste',
      }));
      menu.append(new MenuItem({
        label: this.$t('navbar.contextMenu.pasteAndGo') as string,
        click: () => {
          this.onEnterUrl(clipboard.readText());
        },
      }));

      menu.popup({ window: currentWindow });
    }
  }
  // onCommonMenu
  onCommonMenu(): void {
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();
      const navbar = document.getElementById('browser-navbar');
      const common = document.getElementById('browser-navbar__common');
      let sub: Electron.MenuItemConstructorOptions[] = [
        {
          label: this.$t('navbar.common.options.lulumi') as string,
          click: () => this.onNewTab(this.windowId, 'about:lulumi', false),
        },
      ];

      if (navbar !== null && common !== null) {
        if (is.windows) {
          menu.append(new MenuItem({
            label: this.$t('file.newTab') as string,
            accelerator: 'CmdOrCtrl+T',
            click: () => this.onNewTab(this.windowId, 'about:newtab', false),
          }));
          menu.append(new MenuItem({
            label: this.$t('file.newWindow') as string,
            accelerator: 'CmdOrCtrl+N',
            click: () => this.$electron.remote.BrowserWindow.createWindow(),
          }));
          menu.append(new MenuItem({ type: 'separator' }));
        }

        menu.append(new this.$electron.remote.MenuItem({
          label: this.$t('navbar.common.options.history.title') as string,
          submenu: ([
            {
              label: this.$t('navbar.common.options.history.history') as string,
              click: () => this.onNewTab(this.windowId, 'about:history', false),
            },
            { type: 'separator' },
            {
              label: this.$t('navbar.common.options.history.recentlyClosed') as string,
              enabled: false,
            },
          ] as Electron.MenuItemConstructorOptions[]).concat(this.historyMenuItem),
        }));
        menu.append(new MenuItem({
          label: this.$t('navbar.common.options.downloads') as string,
          click: () => this.onNewTab(this.windowId, 'about:downloads', false),
        }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: this.$t('navbar.common.options.extensions') as string,
          click: () => this.onNewTab(this.windowId, 'about:extensions', false),
        }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: this.$t('navbar.common.options.preferences') as string,
          click: () => this.onNewTab(this.windowId, 'about:preferences', false),
        }));
        if (is.windows) {
          sub = sub.concat([
            {
              label: this.$t('help.reportIssue') as string,
              click: () => this.onNewTab(
                this.windowId,
                'https://github.com/LulumiProject/lulumi-browser/issues',
                true),
            },
            {
              label: this.$t('help.forceReload') as string,
              click: () => currentWindow.webContents.reloadIgnoringCache(),
            },
            {
              label: this.$t('help.toggleDevTools') as string,
              click: () => currentWindow.webContents.toggleDevTools(),
            },
            { type: 'separator' },
            {
              label: this.$t('window.processManager') as string,
              click: () => this.$electron.ipcRenderer.send('open-process-manager'),
            },
          ]);
        }
        menu.append(new MenuItem({
          label: this.$t('navbar.common.options.help') as string,
          submenu: sub,
        }));

        menu.popup({
          window: currentWindow,
          x: Math.floor(common.getBoundingClientRect().right),
          y: Math.floor(navbar.getBoundingClientRect().bottom),
        });
      }
    }
  }
  // onWebviewContextMenu
  onWebviewContextMenu(params: Electron.ContextMenuParams): void {
    const currentWindow: Electron.BrowserWindow | null
      = this.$electron.remote.BrowserWindow.fromId(this.windowId);
    if (currentWindow) {
      const { Menu, MenuItem } = this.$electron.remote;
      const menu = new Menu();
      const clipboard = this.$electron.clipboard;

      const webContents = this.getBrowserView().webContents;
      const tab = this.getTabObject();
      const editFlags = params.editFlags;

      const registerExtensionContextMenus = (menu) => {
        const contextMenus = JSON.parse(JSON.stringify(this.contextMenus));
        Object.keys(contextMenus).forEach((webContentsIdInString) => {
          contextMenus[webContentsIdInString].forEach((menuItems) => {
            menuItems.forEach((menuItem) => {
              if (menuItem.type !== 'separator') {
                menuItem.label = menuItem.label.replace('%s', params.selectionText);
                menuItem.click = (menuItem, browserWindow) => {
                  this.$electron.remote.webContents.fromId(menuItem.webContentsId)
                    .send(
                      `lulumi-context-menus-clicked-${menuItem.extensionId}-${menuItem.id}`,
                      params,
                      this.getTabObject(this.currentTabIndex).id,
                      menuItem,
                      browserWindow);
                };
                const submenu = menuItem.submenu;
                if (submenu) {
                  submenu.forEach((sub) => {
                    sub.label.replace('%s', params.selectionText);
                    sub.click = (menuItem, browserWindow) => {
                      this.$electron.remote.webContents.fromId(sub.webContentsId)
                        .send(
                          `lulumi-context-menus-clicked-${sub.extensionId}-${sub.id}`,
                          params,
                          this.getTabObject(this.currentTabIndex).id,
                          menuItem,
                          browserWindow);
                    };
                  });
                }
              }
            });
            Menu.buildFromTemplate(menuItems).items
              .forEach(menuItem => menu.append(menuItem));
          });
        });
        if (Object.keys(contextMenus).length !== 0) {
          menu.append(new MenuItem({ type: 'separator' }));
        }
      };

      if (params.selectionText) {
        if (is.macos) {
          menu.append(new MenuItem({
            label: this.$t(
              'webview.contextMenu.lookUp', { selectionText: params.selectionText }) as string,
            click: () => {
              webContents.showDefinitionForSelection();
            },
          }));

          menu.append(new MenuItem({ type: 'separator' }));
        }

        if (editFlags.canCopy) {
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.copy') as string,
            role: 'copy',
          }));
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.searchFor', {
              selectionText: params.selectionText,
              searchEngine: this.$store.getters.currentSearchEngine.name,
            }) as string,
            click: () => this.onNewTab(this.windowId, params.selectionText, false),
          }));

          menu.append(new MenuItem({ type: 'separator' }));
        }
      }
      if (params.isEditable) {
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.undo') as string,
          click: () => {
            webContents.undo();
          },
          enabled: editFlags.canUndo,
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.redo') as string,
          click: () => {
            webContents.redo();
          },
          enabled: editFlags.canRedo,
        }));

        menu.append(new MenuItem({ type: 'separator' }));

        if (editFlags.canCut) {
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.cut') as string,
            role: 'cut',
          }));
        }

        if (editFlags.canCopy) {
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.copy') as string,
            role: 'copy',
          }));
        }

        if (editFlags.canPaste) {
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.paste') as string,
            role: 'paste',
          }));
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.pasteAndMatchStyle') as string,
            role: 'pasteandmatchstyle',
          }));
        }

        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.selectAll') as string,
          role: 'selectall',
        }));
      } else if (params.linkURL) {
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.openLinkInNewTab') as string,
          click: () => this.onNewTab(this.windowId, params.linkURL, false),
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.openLinkInNewWindow') as string,
          click: () => {
            webContents.executeJavaScript(`window.open('${params.linkURL}')`);
          },
        }));

        menu.append(new MenuItem({ type: 'separator' }));

        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.copyLinkAddress') as string,
          click: () => {
            clipboard.writeText(params.linkURL);
          },
        }));
      } else if (params.hasImageContents) {
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.openImageInNewTab') as string,
          click: () => this.onNewTab(this.windowId, params.srcURL, false),
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.saveImageAs') as string,
          click: () => {
            const fs = require('fs');
            const electron = this.$electron;
            urlUtil.getFilenameFromUrl(params.srcURL).then(
              (filename) => {
                const defaultPath = path.join(electron.remote.app.getPath('downloads'), filename);
                electron.remote.dialog.showSaveDialog(
                  currentWindow,
                  {
                    defaultPath,
                    filters: [
                      {
                        name: 'Images',
                        extensions: ['jpg', 'jpeg', 'png', 'gif'],
                      },
                    ],
                  },
                  async (filename) => {
                    if (filename) {
                      const dataURL = await imageUtil.getBase64FromImageUrl(params.srcURL);
                      fs.writeFileSync(
                        filename, electron.nativeImage.createFromDataURL(dataURL).toPNG());
                    }
                  },
                );
              },
            );
          },
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.copyImage') as string,
          click: () => {
            const electron = this.$electron;
            urlUtil.getFilenameFromUrl(params.srcURL).then(
              async (filename) => {
                if (filename) {
                  const dataURL = await imageUtil.getBase64FromImageUrl(params.srcURL);
                  clipboard.writeImage(electron.nativeImage.createFromDataURL(dataURL));
                }
              },
            );
          },
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.copyImageUrl') as string,
          click: () => {
            clipboard.writeText(params.srcURL);
          },
        }));
      } else {
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.back') as string,
          click: () => {
            this.onClickBack();
          },
          enabled: tab.canGoBack,
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.forward') as string,
          click: () => {
            this.onClickForward();
          },
          enabled: tab.canGoForward,
        }));
        menu.append(new MenuItem({
          label: this.$t('webview.contextMenu.reload') as string,
          click: () => {
            this.onClickRefresh();
          },
          enabled: tab.canRefresh,
        }));
      }

      menu.append(new MenuItem({ type: 'separator' }));

      // lulumi.contextMenus
      registerExtensionContextMenus(menu);

      const url = urlUtil.getUrlIfError(tab.url);
      if (webContents.getURL() === url) {
        const sourceUrl = urlUtil.getViewSourceUrlFromUrl(url);
        if (sourceUrl !== null) {
          menu.append(new MenuItem({
            label: this.$t('webview.contextMenu.viewSource') as string,
            click: this.onClickViewSource,
          }));
        }
      }
      menu.append(new MenuItem({
        label: this.$t('webview.contextMenu.javascriptPanel') as string,
        click: this.onClickJavaScriptPanel,
      }));
      menu.append(new MenuItem({
        label: this.$t('webview.contextMenu.inspectElement') as string,
        click: () => {
          webContents.inspectElement(params.x, params.y);
        },
      }));

      menu.popup({ window: currentWindow });
    }
  }

  beforeMount() {
    const ipc = this.$electron.ipcRenderer;

    if (process.env.NODE_ENV !== 'testing') {
      const windowProperty = ipc.sendSync('window-id');
      this.windowId = windowProperty.windowId;
      this.windowWebContentsId = windowProperty.windowWebContentsId;

      ipc.once(
        `new-tab-suggestion-for-window-${this.windowId}`,
        (event: Electron.Event, suggestion: Lulumi.Main.BrowserWindowSuggestionItem | null) => {
          if (suggestion !== null && this.tabs.length === 0) {
            this.onNewTab(this.windowId, suggestion.url, suggestion.follow);
          }
        });
      // we have to call ipc.send anyway in order to cancel/trigger the corresponding event listener
      ipc.send(`any-new-tab-suggestion-for-window-${this.windowId}`);
    } else {
      this.windowId = 0;

      if (this.tabs.length === 0) {
        this.onNewTab(this.windowId, 'about:newtab', true);
      }
    }

    this.extensionService = new ExtensionService(this);
  }
  mounted() {
    if (is.macos) {
      document.body.classList.add('darwin');
    }

    const ipc = this.$electron.ipcRenderer;

    ipc.on('go-back', () => {
      this.onClickBack();
    });
    ipc.on('go-forward', () => {
      this.onClickForward();
    });
    ipc.on('reload', () => {
      this.onClickRefresh();
    });
    ipc.on('force-reload', () => {
      this.onClickForceRefresh();
    });
    ipc.on('view-source', () => {
      this.onClickViewSource();
    });
    ipc.on('toggle-dev-tools', () => {
      this.onClickToggleDevTools();
    });
    ipc.on('javascript-panel', () => {
      this.onClickJavaScriptPanel();
    });
    ipc.on('new-tab', (event, payload) => {
      if (payload) {
        this.onNewTab(this.windowId, payload.url, payload.follow);
      } else {
        this.onNewTab(this.windowId, 'about:newtab', false);
      }
    });
    ipc.on('restore-recently-closed-tab', () => {
      if (this.historyMenuItem.length > 0) {
        // trigger manually without filling with expected arguments
        (this.historyMenuItem[0] as any).click();
      }
    });
    ipc.on('tab-close', () => {
      if (this.currentTabIndex !== undefined) {
        this.onTabClose(this.currentTabIndex);
      }
    });
    ipc.on('tab-click', (event: Electron.Event, tabIndexThatWeSee: number) => {
      const els = document.querySelectorAll('.tab') as NodeListOf<HTMLDivElement>;
      const el = (tabIndexThatWeSee === -1)
        ? els[els.length - 1]
        : els[tabIndexThatWeSee];
      if (el) {
        el.click();
      }
    });
    ipc.on(
      'tab-select',
      (event: Electron.Event, direction: 'next' | 'previous') => {
        const els: HTMLDivElement[] = [].slice.call(
          document.querySelectorAll('.tab'));
        const el = document.querySelector('.active');
        if (el) {
          const elIndex: number = els.findIndex(ele => ele.id === el.id);
          if (elIndex !== -1) {
            if (direction === 'next') {
              if (elIndex < els.length - 1) {
                els[elIndex + 1].click();
              } else {
                els[0].click();
              }
            } else if (direction === 'previous') {
              if (elIndex > 0) {
                els[elIndex - 1].click();
              } else {
                els[els.length - 1].click();
              }
            }
          }
        }
      });
    ipc.on('escape-full-screen', () => {
      this.onLeaveHtmlFullScreen();
    });
    ipc.on('start-find-in-page', () => {
      this.getTab(this.currentTabIndex).findInPage();
    });
    ipc.on('open-pdf', (event, data) => {
      this.onOpenPDF(event, data);
    });
    ipc.on('scroll-touch-begin', (event, swipeGesture) => {
      this.onScrollTouchBegin(event, swipeGesture);
    });
    ipc.on('scroll-touch-end', () => {
      this.onScrollTouchEnd();
    });
    ipc.on('scroll-touch-edge', () => {
      this.onScrollTouchEdge();
    });
    ipc.on('enter-full-screen', (event, isDarwin) => {
      this.onEnterFullscreen(isDarwin);
    });
    ipc.on('leave-full-screen', (event, isDarwin) => {
      this.onLeaveFullscreen(isDarwin);
    });
    ipc.on('will-download-any-file', (event, data) => {
      this.onWillDownloadAnyFile(event, data);
    });
    ipc.on('update-downloads-progress', (event, data) => {
      this.onUpdateDownloadsProgress(event, data);
    });
    ipc.on('complete-downloads-progress', (event, data) => {
      this.onCompleteDownloadsProgress(event, data);
    });

    ipc.on('get-search-engine-provider', (event: Electron.Event, webContentsId: number) => {
      this.onGetSearchEngineProvider(event, webContentsId);
    });
    ipc.on('get-homepage', (event: Electron.Event, webContentsId: number) => {
      this.onGetHomepage(event, webContentsId);
    });
    ipc.on('get-pdf-viewer', (event: Electron.Event, webContentsId: number) => {
      this.onGetPDFViewer(event, webContentsId);
    });
    ipc.on('get-tab-config', (event: Electron.Event, webContentsId: number) => {
      this.onGetTabConfig(event, webContentsId);
    });
    ipc.on('get-lang', (event: Electron.Event, webContentsId: number) => {
      this.onGetLang(event, webContentsId);
    });
    ipc.on('get-proxy-config', (event: Electron.Event, webContentsId: number) => {
      this.onGetProxyConfig(event, webContentsId);
    });
    ipc.on('get-auth', (event: Electron.Event, webContentsId: number) => {
      this.onGetAuth(event, webContentsId);
    });
    ipc.on('get-downloads', (event: Electron.Event, webContentsId: number) => {
      this.onGetDownloads(event, webContentsId);
    });
    ipc.on('get-history', (event: Electron.Event, webContentsId: number) => {
      this.onGetHistory(event, webContentsId);
    });

    // browserView events
    const browserViewEvents = {
      'did-start-loading': 'onDidStartLoading',
      'load-commit': 'onLoadCommit',
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
      'did-navigate': 'onDidNavigate',
      'did-navigate-in-page': 'onDidNavigateInPage',
    };
    Object.keys(browserViewEvents).forEach((key) => {
      ipc.on(key, (event, viewId, ...data) => {
        if (this[browserViewEvents[key]]) {
          this[browserViewEvents[key]](viewId, ...data);
        }
      });
    });

    ipc.on('remove-non-bg-lulumi-extension', (event: Electron.Event, extensionId: string) => {
      ipc.send(`remove-lulumi-extension-${extensionId}`);
    });
    ipc.on('about-to-quit', () => {
      const downloads = this.$store.getters.downloads;
      const pendingDownloads = downloads.filter(download => download.state === 'progressing');

      if (pendingDownloads.length !== 0) {
        this.$electron.remote.dialog.showMessageBox(
          {
            type: 'warning',
            title: 'Warning',
            message: 'You still have some files progressing.',
            buttons: ['Abort and Leave', 'Cancel'],
          },
          (index) => {
            if (index === 0) {
              pendingDownloads.forEach((download) => {
                this.$electron.ipcRenderer.send('cancel-downloads-progress', download.startTime);
              });
              ipc.send('okay-to-quit', true);
            } else {
              ipc.send('okay-to-quit', false);
            }
          });
      }
    });

    // https://github.com/electron/electron/blob/master/docs/tutorial/online-offline-events.md
    const updateOnlineStatus = () => {
      ipc.send('online-status-changed', navigator.onLine);
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  }
}
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
body,
html {
  position: relative;
  overflow: hidden;
}

#nav {
  width: 100vw;
}

#footer {
  bottom: 0;
  position: absolute;
}
#footer > .browser-tab-status {
  background: #F3F3F3;
  border-color: #d3d3d3;
  border-style: solid;
  border-width: 1px 1px 0 0;
  border-top-right-radius: 4px;
  bottom: 0;
  color: #555555;
  font-size: 13px;
  float: left;
  width: auto;
  overflow-x: hidden;
  padding: 0.2em 0.5em;
  position: relative;
}
#footer > .extend-enter-active {
  transition-property: text-overflow, white-space;
  transition-duration: 1s;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50vw;
}
</style>
