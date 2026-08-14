/**
 * Windows and tabs over a single Playwright persistent context.
 *
 * Playwright has pages, not Chrome's window/tab tree. This module is that
 * tree: a window is a list of pages, a tab is one page, and the focused tab
 * is the one the screencast and input drive. The profile (cookies, logins) is
 * still the one context. A popup becomes a tab in the window that opened it.
 *
 * There is always at least one window, and that window always has at least
 * one tab. Closing the last tab in a window closes the window, except when it
 * is the last window, which is refused.
 */

import type { BrowserContext, Page } from "playwright";

import { BrowserError, ensureContext } from "./browser.js";
import { currentViewport, startScreencast, stopScreencast } from "./screencast.js";
import { watchPage } from "./watch.js";

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface WindowInfo {
  id: string;
  label: string;
  active: boolean;
  tabs: TabInfo[];
}

export interface SessionInfo {
  windows: WindowInfo[];
  activeWindowId: string;
  activeTabId: string;
}

interface Tab {
  id: string;
  page: Page;
}

interface WindowPane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

let windows: WindowPane[] = [];
let activeWindowId = "";
let nextId = 0;
let bound: BrowserContext | null = null;
const hooked = new WeakSet<Page>();

function alloc(prefix: string): string {
  nextId += 1;
  return `${prefix}${nextId}`;
}

function reset(): void {
  windows = [];
  activeWindowId = "";
  nextId = 0;
  bound = null;
}

function activeWindow(): WindowPane {
  const found = windows.find((window) => window.id === activeWindowId) ?? windows[0];
  if (found === undefined) {
    throw new BrowserError("No browser window is open.", { status: 409 });
  }
  return found;
}

function findWindow(windowId: string): WindowPane {
  const found = windows.find((window) => window.id === windowId);
  if (found === undefined) {
    throw new BrowserError(`No window \`${windowId}\`.`, { status: 404 });
  }
  return found;
}

function findTab(tabId: string): { window: WindowPane; tab: Tab; index: number } {
  for (const window of windows) {
    const index = window.tabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) {
      const tab = window.tabs[index];
      if (tab !== undefined) {
        return { window, tab, index };
      }
    }
  }
  throw new BrowserError(`No tab \`${tabId}\`.`, { status: 404 });
}

function tabCount(): number {
  return windows.reduce((sum, window) => sum + window.tabs.length, 0);
}

async function show(page: Page): Promise<void> {
  await stopScreencast({ keepFrame: false });
  if (page.isClosed()) {
    return;
  }
  try {
    await page.setViewportSize(currentViewport());
  } catch {
    // The page closed between the check and the resize.
  }
  await startScreencast(page);
}

async function titleOf(page: Page): Promise<string> {
  if (page.isClosed()) {
    return "New tab";
  }
  const url = page.url();
  if (url === "" || url === "about:blank") {
    return "New tab";
  }
  try {
    const title = await page.title();
    return title.trim() === "" ? hostLabel(url) : title;
  } catch {
    return hostLabel(url);
  }
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host === "" ? "New tab" : host;
  } catch {
    return "New tab";
  }
}

function hookPage(page: Page, windowId: string): void {
  if (hooked.has(page)) {
    return;
  }
  hooked.add(page);
  watchPage(page, {
    onPopup: (popup) => {
      void addPopupTab(windowId, popup);
    },
  });
  page.on("close", () => {
    void pruneClosed(page);
  });
}

async function addPopupTab(windowId: string, popup: Page): Promise<void> {
  const window = windows.find((item) => item.id === windowId);
  if (window === undefined || popup.isClosed()) {
    return;
  }
  if (windows.some((item) => item.tabs.some((tab) => tab.page === popup))) {
    return;
  }
  const tab: Tab = { id: alloc("t"), page: popup };
  window.tabs.push(tab);
  window.activeTabId = tab.id;
  activeWindowId = window.id;
  hookPage(popup, window.id);
  await show(popup);
}

async function pruneClosed(page: Page): Promise<void> {
  for (const window of windows) {
    const index = window.tabs.findIndex((tab) => tab.page === page);
    if (index < 0) {
      continue;
    }
    if (tabCount() === 1) {
      return;
    }
    const tab = window.tabs[index];
    if (tab === undefined) {
      return;
    }
    try {
      await closeTab(tab.id);
    } catch {
      // Already gone, or this is the last tab.
    }
    return;
  }
}

async function openPage(): Promise<Page> {
  const ctx = await ensureContext();
  const page = await ctx.newPage();
  try {
    await page.setViewportSize(currentViewport());
  } catch {
    // Viewport applies on the next resize from the panel.
  }
  return page;
}

/**
 * Make sure the window/tab tree exists for the current context.
 *
 * A persistent context already has one page. That page becomes window 1, tab 1.
 */
export async function ensureSession(): Promise<void> {
  const ctx = await ensureContext();
  if (bound === ctx && windows.length > 0) {
    return;
  }
  reset();
  bound = ctx;
  ctx.on("close", () => {
    if (bound === ctx) {
      reset();
    }
  });

  const live = ctx.pages().filter((page) => !page.isClosed());
  const pages = live.length > 0 ? live : [await ctx.newPage()];
  const windowId = alloc("w");
  const tabs: Tab[] = [];
  for (const page of pages) {
    const tab: Tab = { id: alloc("t"), page };
    tabs.push(tab);
    hookPage(page, windowId);
  }
  const first = tabs[0];
  if (first === undefined) {
    throw new BrowserError("Could not open a tab.", { status: 503 });
  }
  windows = [{ id: windowId, tabs, activeTabId: first.id }];
  activeWindowId = windowId;
  await show(first.page);
}

/** The focused tab's page. Routes that drive Chromium go through here. */
export async function ensurePage(): Promise<Page> {
  await ensureSession();
  const window = activeWindow();
  const tab = window.tabs.find((item) => item.id === window.activeTabId) ?? window.tabs[0];
  if (tab === undefined) {
    throw new BrowserError("No tab is open.", { status: 409 });
  }
  if (tab.page.isClosed()) {
    const page = await openPage();
    tab.page = page;
    hookPage(page, window.id);
    await show(page);
  }
  await startScreencast(tab.page);
  return tab.page;
}

export async function snapshot(): Promise<SessionInfo> {
  await ensureSession();
  const windowsInfo: WindowInfo[] = [];
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    if (window === undefined) {
      continue;
    }
    const tabs: TabInfo[] = [];
    for (const tab of window.tabs) {
      tabs.push({
        id: tab.id,
        title: await titleOf(tab.page),
        url: tab.page.isClosed() ? "" : tab.page.url(),
        active: tab.id === window.activeTabId,
      });
    }
    windowsInfo.push({
      id: window.id,
      label: `Window ${index + 1}`,
      active: window.id === activeWindowId,
      tabs,
    });
  }
  const active = activeWindow();
  return {
    windows: windowsInfo,
    activeWindowId: active.id,
    activeTabId: active.activeTabId,
  };
}

export function activeTabId(): string {
  if (windows.length === 0) {
    return "";
  }
  return activeWindow().activeTabId;
}

export async function newTab(windowId?: string): Promise<SessionInfo> {
  await ensureSession();
  const window = windowId === undefined ? activeWindow() : findWindow(windowId);
  const page = await openPage();
  const tab: Tab = { id: alloc("t"), page };
  window.tabs.push(tab);
  window.activeTabId = tab.id;
  activeWindowId = window.id;
  hookPage(page, window.id);
  await show(page);
  return snapshot();
}

export async function newWindow(): Promise<SessionInfo> {
  await ensureSession();
  const page = await openPage();
  const tabId = alloc("t");
  const windowId = alloc("w");
  const tab: Tab = { id: tabId, page };
  windows.push({ id: windowId, tabs: [tab], activeTabId: tabId });
  activeWindowId = windowId;
  hookPage(page, windowId);
  await show(page);
  return snapshot();
}

export async function selectTab(tabId: string): Promise<SessionInfo> {
  await ensureSession();
  const found = findTab(tabId);
  found.window.activeTabId = tabId;
  activeWindowId = found.window.id;
  await show(found.tab.page);
  return snapshot();
}

export async function selectWindow(windowId: string): Promise<SessionInfo> {
  await ensureSession();
  const window = findWindow(windowId);
  activeWindowId = window.id;
  const tab = window.tabs.find((item) => item.id === window.activeTabId) ?? window.tabs[0];
  if (tab === undefined) {
    throw new BrowserError("No tab is open.", { status: 409 });
  }
  await show(tab.page);
  return snapshot();
}

export async function closeTab(tabId: string): Promise<SessionInfo> {
  await ensureSession();
  if (tabCount() <= 1) {
    throw new BrowserError("Keep at least one tab.", { status: 400 });
  }
  const found = findTab(tabId);
  if (found.window.tabs.length === 1) {
    return closeWindow(found.window.id);
  }
  found.window.tabs.splice(found.index, 1);
  const wasShowing = activeWindowId === found.window.id && found.window.activeTabId === tabId;
  if (found.window.activeTabId === tabId) {
    const neighbor = found.window.tabs[Math.min(found.index, found.window.tabs.length - 1)];
    if (neighbor !== undefined) {
      found.window.activeTabId = neighbor.id;
    }
  }
  if (!found.tab.page.isClosed()) {
    try {
      await found.tab.page.close();
    } catch {
      // Already gone.
    }
  }
  if (wasShowing) {
    const next = found.window.tabs.find((tab) => tab.id === found.window.activeTabId);
    if (next !== undefined) {
      await show(next.page);
    }
  }
  return snapshot();
}

export async function closeWindow(windowId: string): Promise<SessionInfo> {
  await ensureSession();
  if (windows.length <= 1) {
    throw new BrowserError("Keep at least one window.", { status: 400 });
  }
  const window = findWindow(windowId);
  const index = windows.indexOf(window);
  const wasActive = activeWindowId === windowId;
  windows.splice(index, 1);
  for (const tab of window.tabs) {
    if (!tab.page.isClosed()) {
      try {
        await tab.page.close();
      } catch {
        // Already gone.
      }
    }
  }
  if (wasActive) {
    const neighbor = windows[Math.min(index, windows.length - 1)] ?? windows[0];
    if (neighbor === undefined) {
      throw new BrowserError("Keep at least one window.", { status: 400 });
    }
    activeWindowId = neighbor.id;
    const tab = neighbor.tabs.find((item) => item.id === neighbor.activeTabId) ?? neighbor.tabs[0];
    if (tab !== undefined) {
      await show(tab.page);
    }
  }
  return snapshot();
}
