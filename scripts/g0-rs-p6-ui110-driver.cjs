#!/usr/bin/env node
'use strict';

/**
 * Electron-side P6 UI-110 scientific-editing trace.
 *
 * This process owns one real BrowserWindow. The parent owns the disposable
 * backend, local scripted gateway, Vite server, source binding, and canonical
 * evidence. Configuration contains transient Result Studio coordinates but
 * the result written here intentionally contains no IDs, URLs, paths, prompt
 * text, or model/tool payloads.
 */

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const CONFIG_ENV = 'BIOF3_P6_UI110_DRIVER_CONFIG';
const PRELOAD_PATH = path.resolve(__dirname, '..', 'src', 'preload.js');
const SHORT_WAIT_MS = 45_000;
const AGENT_WAIT_MS = 12 * 60 * 1000;
const RESTORE_WAIT_MS = 90_000;
const POLL_MS = 125;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableDigest(value) {
  return digest(JSON.stringify(stable(value)));
}

function canonicalIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function objectBinding(changeSet, revisions = []) {
  const revisionIds = canonicalIds(changeSet?.candidateArtifactRefs?.length
    ? changeSet.candidateArtifactRefs
    : revisions.map((revision) => revision?.revisionId));
  const jobIds = canonicalIds(changeSet?.jobRefs?.length
    ? changeSet.jobRefs
    : revisions.map((revision) => revision?.toolJobId));
  const identity = {
    changeSetId: String(changeSet?.changeSetId || '').trim(),
    revisionIds,
    jobIds,
  };
  if (!identity.changeSetId || revisionIds.length === 0 || jobIds.length === 0) {
    throw new Error('stage binding requires one complete ChangeSet cohort');
  }
  return {
    objectDigest: stableDigest(identity),
    changeSetDigest: stableDigest(identity.changeSetId),
    revisionSetDigest: stableDigest(revisionIds),
    jobSetDigest: stableDigest(jobIds),
    revisionCount: revisionIds.length,
    jobCount: jobIds.length,
    status: String(changeSet.status || ''),
  };
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath || !path.isAbsolute(configPath)) {
    throw new Error(`${CONFIG_ENV} must point to an absolute disposable config path`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of ['uiBaseUrl', 'backendBaseUrl', 'projectId', 'conversationId', 'outputDir', 'resultPath']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`driver config missing ${key}`);
  }
  const assertLoopbackUrl = (value, label) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${label} must be a valid URL`);
    }
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/') {
      throw new Error(`driver only accepts an isolated loopback ${label}`);
    }
    return parsed;
  };
  const uiUrl = assertLoopbackUrl(config.uiBaseUrl, 'Vite URL');
  const backendUrl = assertLoopbackUrl(config.backendBaseUrl, 'backend URL');
  if (uiUrl.port === backendUrl.port) throw new Error('driver UI and backend ports must differ');
  for (const name of ['deg', 'volcano', 'heatmap']) {
    const target = config.targets && config.targets[name];
    if (!target || typeof target.jobId !== 'string' || typeof target.artifact !== 'string'
      || typeof target.artifactFamilyId !== 'string' || !target.artifactFamilyId) {
      throw new Error(`driver target missing: ${name}`);
    }
  }
  if (!Number.isFinite(config.changedLfc) || config.changedLfc <= 0) throw new Error('driver changedLfc missing');
  return config;
}

function targetUrl(config, target, mode = 'result') {
  return `${config.uiBaseUrl}/project/${encodeURIComponent(config.projectId)}`
    + `?mode=${encodeURIComponent(mode)}&job=${encodeURIComponent(target.jobId)}`
    + `&artifact=${encodeURIComponent(target.artifact)}`;
}

async function waitFor(webContents, expression, label, timeoutMs = SHORT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await webContents.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await pause(POLL_MS);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function pageBoolean(webContents, expression) {
  return webContents.executeJavaScript(`Boolean(${expression})`, true);
}

async function semanticSnapshot(webContents) {
  const snapshot = await webContents.executeJavaScript(`
    (() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      const absolutePathLocations = new Set();
      const publicText = (root) => {
        if (!root) return '';
        const chunks = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const parent = node.parentElement;
          const closedDetails = parent?.closest('details:not([open])');
          const insideVisibleSummary = closedDetails && parent?.closest('summary') === closedDetails.querySelector(':scope > summary');
          const hiddenAncestor = parent?.closest('[hidden], [aria-hidden="true"]');
          if (parent && !hiddenAncestor && (!closedDetails || insideVisibleSummary)) {
            const style = getComputedStyle(parent);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              const value = node.nodeValue || '';
              chunks.push(value);
              if (/(?:\/Users\/|\/home\/|[A-Za-z]:\\\\)/.test(value)) {
                const location = parent.closest('pre') ? 'preformatted_text'
                  : parent.closest('code') ? 'structured_value'
                    : parent.closest('.sc-msg-assistant, .sc-msg-user') ? 'conversation'
                      : parent.closest('[aria-label="Result Studio 版本与变更"]') ? 'change_review'
                        : parent.closest('[aria-label="高级精细调整"]') ? 'advanced_drawer'
                          : 'other_visible_text';
                absolutePathLocations.add(location);
              }
            }
          }
          node = walker.nextNode();
        }
        return chunks.join(' ');
      };
      const text = publicText(document.body);
      const checkedRows = [...document.querySelectorAll('input[aria-label^="选择 "]')]
        .filter((input) => input.checked).length;
      const loadedImage = (image) => image instanceof HTMLImageElement
        && image.complete && image.naturalWidth > 0 && visible(image);
      const visualImages = canvas ? [...canvas.querySelectorAll('img')].filter(loadedImage).length : 0;
      const bodyNodes = canvas
        ? [...canvas.querySelectorAll('img, table, svg, iframe, pre, [role="img"], [data-viewer], [data-mode="table"], [data-mode="scatter"], [data-mode="matrix"]')]
        : [];
      return {
        canvasPresent: !!canvas,
        mode: canvas?.getAttribute('data-mode') || null,
        bodyVisible: bodyNodes.some(visible),
        composerState: document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') || 'absent',
        advancedDrawerPresent: !!document.querySelector('details[aria-label="高级精细调整"]'),
        versionPanelPresent: !!document.querySelector('[aria-label="Result Studio 版本与变更"]'),
        selectedEntityCount: checkedRows,
        visualImageCount: visualImages,
        tablePresent: !!document.querySelector('[aria-label="科学结果表格"]'),
        rowHeaderPresent: !!document.querySelector('[aria-label="科学结果表格"] input[aria-label^="选择 "]'),
        assistantMessageCount: document.querySelectorAll('.sc-msg-assistant').length,
        resultProgressPresent: !!document.querySelector('[aria-label="结果修改五阶段进度"]'),
        stopControlPresent: !!document.querySelector('.sc-send-cta-stop'),
        scientificDifferenceVisible: text.includes('科学结论差异'),
        degDifferenceVisible: text.includes('显著基因') && text.includes('关键基因变化'),
        enrichmentRankAndDirectionVisible: text.includes('前列通路') && text.includes('方向变化'),
        impactPresentationVisible: text.includes('展示变化'),
        impactScientificVisible: text.includes('科学重算') || text.includes('流程变化'),
        executionNodesVisible: !!document.querySelector('[aria-label="实际执行节点"]'),
        internalLeakFlags: {
          absolutePath: /(?:\\/Users\\/|\\/home\\/|[A-Za-z]:\\\\)/.test(text),
          absolutePathLocations: [...absolutePathLocations].sort(),
          credential: /(?:sk-[A-Za-z0-9]{12,}|api[_ -]?key\\s*[:=])/i.test(text),
          rawInternalId: /\\b(?:rev|cs|tj|sel|conv|p)_[a-z0-9_-]{6,}\\b/i.test(text),
        },
      };
    })()
  `, true);
  return { ...snapshot, domSha256: digest(JSON.stringify(snapshot)) };
}

async function captureScreenshot(window, outputDir, label) {
  const png = (await window.webContents.capturePage()).toPNG();
  const file = `${label}.png`;
  writeFileSync(path.join(outputDir, file), png);
  return {
    screenshot: file,
    screenshotSha256: digest(png),
    screenshotBytes: png.length,
  };
}

async function dismissOnboarding(webContents) {
  const outcome = await waitFor(webContents, `
    (() => {
      const completed = localStorage.getItem('biof3-onboarding-completed') === '1';
      const dialog = document.querySelector('[role="dialog"][aria-label="首次启动引导"]');
      if (completed && !dialog) return { state: 'already_completed' };
      const button = dialog && [...dialog.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '跳过引导' && !item.disabled);
      if (!button) return null;
      button.click();
      return { state: 'dismissed' };
    })()
  `, 'first-run onboarding');
  if (outcome.state === 'dismissed') {
    await waitFor(webContents, `
      localStorage.getItem('biof3-onboarding-completed') === '1'
        && !document.querySelector('[role="dialog"][aria-label="首次启动引导"]')
    `, 'first-run onboarding dismissal');
  }
}

async function loadTarget(window, config, target, label) {
  await window.loadURL(targetUrl(config, target));
  const wc = window.webContents;
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="结果主画布"]'))`, `${label} result canvas`);
  await dismissOnboarding(wc);
  await waitFor(wc,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    `${label} context binding`,
  );
  await waitFor(wc,
    `(() => {
      const canvas = document.querySelector('[aria-label="结果主画布"]');
      if (!canvas) return false;
      const loadedImage = [...canvas.querySelectorAll('img')]
        .some((image) => image.complete && image.naturalWidth > 0);
      return loadedImage || Boolean(canvas.querySelector(
        'table, svg, iframe, pre, [role="img"], [data-viewer], [data-mode="table"], [data-mode="scatter"], [data-mode="matrix"]'
      ));
    })()`,
    `${label} result body`,
  );
  return semanticSnapshot(wc);
}

async function readFamilyLedger(webContents, config, target) {
  const url = `${config.backendBaseUrl}/api/result-studio/changesets`
    + `?projectId=${encodeURIComponent(config.projectId)}`
    + `&artifactFamilyId=${encodeURIComponent(target.artifactFamilyId)}`
    + '&revisionOffset=0&revisionLimit=200';
  const ledger = await webContents.executeJavaScript(`
    fetch(${JSON.stringify(url)})
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'result_studio_ledger_unavailable');
        return data;
      })
  `, true);
  if (!Array.isArray(ledger?.changeSets) || !Array.isArray(ledger?.revisions)) {
    throw new Error('Result Studio family ledger is incomplete');
  }
  return ledger;
}

function familyTracker(ledger) {
  return {
    changeSetIds: new Set((ledger?.changeSets || []).map((entry) => entry?.changeSetId).filter(Boolean)),
  };
}

function boundChangeSetFromLedger(ledger, changeSetId) {
  const changeSet = ledger.changeSets.find((entry) => entry?.changeSetId === changeSetId) || null;
  if (!changeSet) return null;
  const candidateIds = new Set(changeSet.candidateArtifactRefs || []);
  const revisions = ledger.revisions.filter((revision) => candidateIds.has(revision?.revisionId));
  return { changeSet, revisions, binding: objectBinding(changeSet, revisions) };
}

async function waitForNewChangeSet(webContents, config, target, tracker, expectedStatus) {
  const deadline = Date.now() + AGENT_WAIT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const ledger = await readFamilyLedger(webContents, config, target);
    const candidates = ledger.changeSets
      .filter((entry) => !tracker.changeSetIds.has(entry?.changeSetId)
        && (!expectedStatus || entry?.status === expectedStatus));
    last = candidates.map((entry) => ({ status: entry.status }));
    if (candidates.length === 1) {
      const captured = boundChangeSetFromLedger(ledger, candidates[0].changeSetId);
      if (captured) {
        tracker.changeSetIds.add(captured.changeSet.changeSetId);
        return captured;
      }
    }
    if (candidates.length > 1) throw new Error('stage produced more than one unbound ChangeSet');
    await pause(POLL_MS);
  }
  throw new Error(`timed out binding stage ChangeSet; last=${JSON.stringify(last)}`);
}

async function waitForKnownChangeSetStatus(webContents, config, target, changeSetId, expectedStatus) {
  const deadline = Date.now() + AGENT_WAIT_MS;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const panelError = await webContents.executeJavaScript(`
      document.querySelector('[aria-label="Result Studio 版本与变更"] [role="alert"]')
        ?.textContent?.trim()?.slice(0, 500) || null
    `, true);
    if (panelError) throw new Error(`ChangeSet ${expectedStatus} failed: ${panelError}`);
    const ledger = await readFamilyLedger(webContents, config, target);
    const captured = boundChangeSetFromLedger(ledger, changeSetId);
    lastStatus = captured?.changeSet?.status || null;
    if (captured && lastStatus === expectedStatus) return captured;
    await pause(POLL_MS);
  }
  throw new Error(`timed out waiting for exact ChangeSet status ${expectedStatus}; last=${lastStatus}`);
}

function targetForRevision(target, revision) {
  const artifact = String(revision?.outputPath || '').split('/').pop() || revision?.artifactId;
  if (!revision?.toolJobId || !artifact) throw new Error('current Revision has no reopen coordinate');
  return {
    jobId: revision.toolJobId,
    artifact,
    artifactFamilyId: target.artifactFamilyId,
  };
}

async function readInteractionCoordinate(webContents, config, target, revisionId = null) {
  const query = new URLSearchParams({
    jobId: target.jobId,
    artifact: target.artifact,
    ...(revisionId ? { revisionId } : {}),
  });
  const url = `${config.backendBaseUrl}/api/result-studio/interaction?${query.toString()}`;
  const data = await webContents.executeJavaScript(`
    fetch(${JSON.stringify(url)})
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'result_interaction_unavailable');
        return body;
      })
  `, true);
  if (!data?.revision?.revisionId || !data?.revision?.artifactFamilyId) {
    throw new Error('interaction did not resolve one formal Revision');
  }
  return data;
}

function countProjection(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['significantCount', 'upCount', 'downCount', 'nonSignificantCount']) {
    if (Number.isInteger(value[key])) result[key] = value[key];
  }
  return Object.keys(result).length > 0 ? result : null;
}

function membershipProjection(value) {
  if (!value || typeof value !== 'object') return null;
  const projection = {};
  for (const key of ['gainedCount', 'lostCount', 'retainedCount']) {
    if (Number.isInteger(value[key])) projection[key] = value[key];
  }
  const members = {
    gained: canonicalIds(value.gained),
    lost: canonicalIds(value.lost),
  };
  if (members.gained.length > 0 || members.lost.length > 0) projection.membershipDigest = stableDigest(members);
  return Object.keys(projection).length > 0 ? projection : null;
}

function projectScientificComparison(comparison) {
  const artifacts = (comparison?.artifacts || []).filter((artifact) => artifact?.scientific)
    .map((artifact) => {
      const scientific = artifact.scientific;
      const projected = {
        artifactId: String(artifact.artifactId || ''),
        kind: String(scientific.kind || ''),
        beforeSha256: /^[a-f0-9]{64}$/.test(artifact.beforeHash || '') ? artifact.beforeHash : null,
        afterSha256: /^[a-f0-9]{64}$/.test(artifact.afterHash || '') ? artifact.afterHash : null,
      };
      if (scientific.significantGenes) {
        projected.significantGenes = {
          before: countProjection(scientific.significantGenes.before),
          after: countProjection(scientific.significantGenes.after),
          membership: membershipProjection(scientific.significantGenes.membership),
        };
      }
      if (scientific.classifications) {
        projected.classifications = {
          before: countProjection(scientific.classifications.before),
          after: countProjection(scientific.classifications.after),
          membership: membershipProjection(scientific.classifications.membership),
        };
      }
      if (scientific.terms) {
        projected.terms = {
          beforeCount: scientific.terms.beforeCount,
          afterCount: scientific.terms.afterCount,
          membership: membershipProjection(scientific.terms.membership),
          topBeforeDigest: stableDigest(scientific.terms.topBefore || []),
          topAfterDigest: stableDigest(scientific.terms.topAfter || []),
        };
      }
      if (scientific.direction) {
        projected.direction = {
          status: String(scientific.direction.status || ''),
          changedCount: Number.isInteger(scientific.direction.changedCount)
            ? scientific.direction.changedCount : null,
          detailDigest: stableDigest({
            before: scientific.direction.before || [],
            after: scientific.direction.after || [],
            changes: scientific.direction.changes || [],
          }),
        };
      }
      return projected;
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return { artifactCount: artifacts.length, artifacts, summaryDigest: stableDigest(artifacts) };
}

async function visibleScientificProjection(webContents) {
  const raw = await webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('h5')]
      .filter((heading) => (heading.textContent || '').trim() === '科学结论差异')
      .map((heading) => [...(heading.parentElement?.querySelectorAll('tr') || [])].map((row) => {
        const cells = [...row.querySelectorAll('td')].map((cell) => (cell.textContent || '').trim());
        return { label: cells[0] || '', value: cells[1] || '' };
      })))()
  `, true);
  const numberList = (text) => [...String(text || '').matchAll(/\d+/g)].map((match) => Number(match[0]));
  const sections = (Array.isArray(raw) ? raw : []).map((rows) => {
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    const projection = {};
    for (const [key, label] of [
      ['significantGenes', '显著基因'],
      ['geneMembership', '关键基因变化'],
      ['classification', '显著分类'],
      ['classificationMembership', '标记基因变化'],
      ['terms', '富集条目'],
      ['termMembership', '通路变化'],
      ['directionChanges', '方向变化'],
    ]) {
      if (byLabel.has(label)) projection[key] = numberList(byLabel.get(label));
    }
    return projection;
  });
  return {
    sectionCount: sections.length,
    sections,
    displayDigest: stableDigest(raw),
  };
}

async function selectExactReviewChangeSet(webContents, changeSetId) {
  await waitFor(webContents, `
    (() => {
      const select = document.querySelector('[aria-label="Result Studio 版本与变更"] select');
      return select instanceof HTMLSelectElement
        && [...select.options].some((option) => option.value === ${JSON.stringify(changeSetId)});
    })()
  `, 'exact review ChangeSet option');
  const selected = await webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const select = panel?.querySelector('select');
      if (!(select instanceof HTMLSelectElement)) return null;
      if (![...select.options].some((option) => option.value === ${JSON.stringify(changeSetId)})) return false;
      if (select.value !== ${JSON.stringify(changeSetId)}) {
        select.value = ${JSON.stringify(changeSetId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    })()
  `, true);
  if (selected !== true) throw new Error('exact stage ChangeSet is absent from the review picker');
}

async function clickButtonByText(webContents, text, scope = 'document') {
  const clicked = await webContents.executeJavaScript(`
    (() => {
      const root = ${scope === 'panel'
        ? "document.querySelector('[aria-label=\"Result Studio 版本与变更\"]')"
        : scope === 'advanced'
          ? "document.querySelector('details[aria-label=\"高级精细调整\"]')"
          : 'document'};
      const button = root && [...root.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === ${JSON.stringify(text)} && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error(`button unavailable: ${text}`);
}

async function setInputValue(webContents, selector, value) {
  const changed = await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === ${JSON.stringify(String(value))};
    })()
  `, true);
  if (!changed) throw new Error(`input unavailable: ${selector}`);
}

async function setSelectValue(webContents, selector, value) {
  const changed = await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLSelectElement)) return false;
      input.value = ${JSON.stringify(String(value))};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === ${JSON.stringify(String(value))};
    })()
  `, true);
  if (!changed) throw new Error(`select unavailable: ${selector}`);
}

async function setCheckbox(webContents, selector, checked) {
  const changed = await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return false;
      if (input.checked !== ${checked ? 'true' : 'false'}) input.click();
      return input.checked === ${checked ? 'true' : 'false'};
    })()
  `, true);
  if (!changed) throw new Error(`checkbox unavailable: ${selector}`);
}

async function setLabeledInputValue(webContents, labelText, value) {
  const changed = await webContents.executeJavaScript(`
    (() => {
      const label = [...document.querySelectorAll('section[aria-label="结果编辑"] label')]
        .find((item) => (item.textContent || '').includes(${JSON.stringify(labelText)}));
      const input = label?.querySelector('input');
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === ${JSON.stringify(String(value))};
    })()
  `, true);
  if (!changed) throw new Error(`labeled input unavailable: ${labelText}`);
}

async function setLabeledCheckbox(webContents, labelText, checked) {
  const changed = await webContents.executeJavaScript(`
    (() => {
      const label = [...document.querySelectorAll('section[aria-label="结果编辑"] label')]
        .find((item) => (item.textContent || '').includes(${JSON.stringify(labelText)}));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) return false;
      if (input.checked !== ${checked ? 'true' : 'false'}) input.click();
      return input.checked === ${checked ? 'true' : 'false'};
    })()
  `, true);
  if (!changed) throw new Error(`labeled checkbox unavailable: ${labelText}`);
}

async function selectRows(webContents, config, target, count = 3) {
  const availability = await waitFor(webContents, `
    (() => {
      const rows = [...document.querySelectorAll('[aria-label="科学结果表格"] input[aria-label^="选择 "]')]
        .filter((input) => !input.disabled);
      const points = [...document.querySelectorAll('[aria-label="可选择科学散点图"] [role="button"][aria-label^="选择 "]')]
        .filter((point) => point.getAttribute('aria-disabled') !== 'true' && point.tabIndex >= 0);
      return rows.length > 0 || points.length > 0
        ? { tableControls: rows.length, scatterControls: points.length }
        : null;
    })()
  `, 'selectable stable result entities');
  const requested = Math.max(1, Number(count) || 1);
  const clicked = await webContents.executeJavaScript(`
    (() => {
      const requested = ${requested};
      const rows = [...document.querySelectorAll('[aria-label="科学结果表格"] input[aria-label^="选择 "]')]
        .filter((input) => !input.disabled)
        .slice(0, requested);
      if (rows.length > 0) {
        for (const input of rows) if (!input.checked) input.click();
        return { mode: 'table', requested: rows.length };
      }

      // Plot artifacts expose stable selectable entities as SVG buttons rather
      // than table rows. The same Result Studio selection binding must cover
      // both renderers, so select a bounded set through their public ARIA
      // contract instead of relying on visual coordinates.
      const points = [...document.querySelectorAll('[aria-label="可选择科学散点图"] [role="button"][aria-label^="选择 "]')]
        .filter((point) => point.getAttribute('aria-disabled') !== 'true' && point.tabIndex >= 0)
        // A scatter point click uses the public point-selection contract,
        // which intentionally replaces the prior selection. Select one
        // stable gene instead of falsely recording a multi-point selection.
        .slice(0, 1);
      for (const point of points) {
        if (point.getAttribute('aria-pressed') !== 'true') {
          point.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
      }
      return points.length > 0 ? { mode: 'scatter', requested: points.length } : null;
    })()
  `, true);
  if (!clicked?.mode || !Number.isInteger(clicked.requested) || clicked.requested <= 0) {
    throw new Error(`could not dispatch stable result selection: ${JSON.stringify(availability)}`);
  }
  const selectedEntityIds = await waitFor(webContents, `
    (() => {
      const tableSelected = [...document.querySelectorAll('[aria-label="科学结果表格"] input[aria-label^="选择 "]')]
        .filter((input) => input.checked);
      const scatterSelected = [...document.querySelectorAll('[aria-label="可选择科学散点图"] [role="button"][aria-pressed="true"]')];
      const selected = ${JSON.stringify(clicked.mode)} === 'table' ? tableSelected : scatterSelected;
      const ids = selected.map((element) => String(element.getAttribute('aria-label') || '')
        .replace(/^选择\\s+/, '').trim()).filter(Boolean);
      return ids.length > 0 ? ids : null;
    })()
  `, 'stable result selection commit');
  await waitFor(webContents,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'
      && (document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.textContent || '').includes('当前选择会一并绑定给 Agent')`,
    'selection context refresh',
  );
  const contextUrl = new URL(`${config.backendBaseUrl}/api/result-studio/context-envelope`);
  contextUrl.searchParams.set('projectId', config.projectId);
  contextUrl.searchParams.set('conversationId', config.conversationId);
  contextUrl.searchParams.set('jobId', target.jobId);
  contextUrl.searchParams.set('artifact', target.artifact);
  const context = await webContents.executeJavaScript(`
    fetch(${JSON.stringify(contextUrl.toString())})
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'selection_context_unavailable');
        return data;
      })
  `, true);
  const selection = context?.envelope?.selection;
  const boundRevisionId = context?.envelope?.revision?.revisionId;
  const boundArtifactId = context?.envelope?.artifact?.artifactId;
  const canonicalSelectedIds = canonicalIds(selectedEntityIds);
  const projectedIds = canonicalIds(selection?.sampleEntityIds);
  const expectedEntityIdsHash = stableDigest(canonicalSelectedIds);
  if (!selection?.selectionId || !boundRevisionId || !boundArtifactId
      || selection.entityType !== 'gene' || selection.truncated === true
      || selection.entityIdCount !== canonicalSelectedIds.length
      || context?.envelope?.selectionState?.compatibility !== 'compatible'
      || selection.entityIdsHash !== expectedEntityIdsHash
      || projectedIds.length !== canonicalSelectedIds.length
      || projectedIds.some((value, index) => value !== canonicalSelectedIds[index])) {
    throw new Error('persisted SelectionContext does not exactly match the stable UI entity set');
  }
  const identity = {
    selectionId: selection.selectionId,
    revisionId: boundRevisionId,
    artifactId: boundArtifactId,
    entityIdsHash: selection.entityIdsHash,
    entityIdCount: selection.entityIdCount,
  };
  return {
    count: canonicalSelectedIds.length,
    entityIdsHash: selection.entityIdsHash,
    entitySetDigest: stableDigest(canonicalSelectedIds),
    objectDigest: stableDigest(identity),
    selectionDigest: stableDigest(selection.selectionId),
    revisionDigest: stableDigest(boundRevisionId),
    artifactDigest: stableDigest(boundArtifactId),
    exact: true,
  };
}

async function waitForAgentSettlement(webContents, beforeMessages, {
  requiresResultProgress = false,
  expectedCompletion = null,
} = {}) {
  const deadline = Date.now() + AGENT_WAIT_MS;
  let sawRunning = false;
  let sawProgress = false;
  let last = null;
  while (Date.now() < deadline) {
    last = await webContents.executeJavaScript(`
      (() => {
        const assistantMessages = [...document.querySelectorAll('.sc-msg-assistant')];
        return {
          assistantCount: assistantMessages.length,
          assistantText: assistantMessages.at(-1)?.textContent?.trim() || '',
          running: !!document.querySelector('.sc-send-cta-stop'),
          progress: !!document.querySelector('[aria-label="结果修改五阶段进度"]'),
          terminal: !!document.querySelector('[aria-label="结果修改五阶段进度"] strong'),
        };
      })()
    `, true);
    sawRunning = sawRunning || last.running === true;
    sawProgress = sawProgress || last.progress === true;
    const completionVisible = !expectedCompletion || last.assistantText.includes(expectedCompletion);
    const freshCompletion = last.assistantCount > beforeMessages
      || (sawRunning && completionVisible);
    if (freshCompletion && !last.running && (!requiresResultProgress || sawProgress)) {
      if (expectedCompletion && !last.assistantText.includes(expectedCompletion)) {
        throw new Error('agent terminal response did not confirm the expected successful outcome');
      }
      return { sawRunning, sawProgress, assistantMessageCount: last.assistantCount };
    }
    await pause(POLL_MS);
  }
  throw new Error(`agent did not settle: ${JSON.stringify(last)}`);
}

async function submitComposer(window, prompt, { requiresResultProgress = false } = {}) {
  const wc = window.webContents;
  const beforeMessages = await wc.executeJavaScript(`document.querySelectorAll('.sc-msg-assistant').length`, true);
  await setInputValue(wc, 'textarea[aria-label="描述你希望当前结果发生什么变化"]', prompt);
  await clickButtonByText(wc, '交给 Agent');
  return waitForAgentSettlement(wc, beforeMessages, {
    requiresResultProgress,
    expectedCompletion: requiresResultProgress
      ? '候选版本已经生成'
      : '富集任务已经提交',
  });
}

async function reloadForCandidate(window, config, target, label) {
  await loadTarget(window, config, target, `${label} candidate reload`);
  await waitFor(window.webContents,
    `[...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] button')]
      .some((item) => (item.textContent || '').trim() === '采用此版本')`,
    `${label} preview candidate`,
    AGENT_WAIT_MS,
  );
}

async function openMode(webContents, modeLabel, expectedMode) {
  await waitFor(webContents,
    `[...document.querySelectorAll('button')]
      .some((item) => (item.textContent || '').trim() === ${JSON.stringify(modeLabel)} && !item.disabled)`,
    `${modeLabel} control`,
  );
  await clickButtonByText(webContents, modeLabel);
  await waitFor(webContents,
    `document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') === ${JSON.stringify(expectedMode)}`,
    `${modeLabel} mode`,
  );
}

async function reviewCandidate(window, config, captured, expected = {}) {
  const wc = window.webContents;
  await openMode(wc, '审查修改', 'compare');
  await waitFor(wc, `Boolean(document.querySelector('[aria-label="Result Studio 版本与变更"]'))`, 'change review panel');
  await selectExactReviewChangeSet(wc, captured.changeSet.changeSetId);
  const readiness = await waitFor(wc, `
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      if (!panel) return null;
      const text = panel.innerText || '';
      const error = panel.querySelector('[role="alert"]')?.textContent?.trim();
      if (error) return { error };
      const visualReady = [...panel.querySelectorAll('img[alt$="修改前"], img[alt$="修改后"]')]
        .filter((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length >= 2;
      const scientificReady = text.includes('科学结论差异');
      const genericReady = visualReady || scientificReady
        || text.includes('参数与结构变化') || text.includes('脚本与文本变化');
      const ready = ${expected.visual ? 'visualReady' : 'true'}
        && ${(expected.deg || expected.enrichment) ? 'scientificReady' : 'genericReady'};
      return ready ? { ready: true } : null;
    })()
  `, 'change review content', AGENT_WAIT_MS);
  if (readiness.error) throw new Error(`change review failed: ${readiness.error}`);
  const snapshot = await semanticSnapshot(wc);
  if (expected.visual && snapshot.visualImageCount < 2) throw new Error('visual compare did not show both versions');
  if (expected.deg && !snapshot.degDifferenceVisible) throw new Error('DEG scientific difference is not visible');
  if (expected.enrichment && !snapshot.enrichmentRankAndDirectionVisible) throw new Error('enrichment rank/direction difference is not visible');
  if (expected.scientific && !snapshot.impactScientificVisible) throw new Error('scientific impact label is not visible');
  if (expected.presentation && !snapshot.impactPresentationVisible) throw new Error('presentation impact label is not visible');
  const comparisonUrl = `${config.backendBaseUrl}/api/result-studio/changesets/`
    + encodeURIComponent(captured.changeSet.changeSetId) + '/compare';
  const comparison = await wc.executeJavaScript(`
    fetch(${JSON.stringify(comparisonUrl)})
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'result_comparison_unavailable');
        return data;
      })
  `, true);
  if (comparison?.changeSet?.changeSetId !== captured.changeSet.changeSetId) {
    throw new Error('review response was not bound to the exact stage ChangeSet');
  }
  const scientificSummary = projectScientificComparison(comparison);
  const visibleScientificSummary = await visibleScientificProjection(wc);
  if ((expected.deg || expected.enrichment)
      && (scientificSummary.artifactCount === 0 || visibleScientificSummary.sectionCount === 0)) {
    throw new Error('exact scientific summary values were not projected into the review UI');
  }
  return {
    ...snapshot,
    changeSetObjectDigest: captured.binding.objectDigest,
    scientificSummary,
    visibleScientificSummary,
  };
}

async function adoptThenRestore(window, config, target, tracker, candidate, { onStage } = {}) {
  const wc = window.webContents;
  await clickButtonByText(wc, '采用此版本', 'panel');
  const adoptedCapture = await waitForKnownChangeSetStatus(
    wc, config, target, candidate.changeSet.changeSetId, 'adopted',
  );
  onStage?.('volcano_adopted');
  const adoptedLedger = await readFamilyLedger(wc, config, target);
  const adoptedCurrent = adoptedLedger.currentRevision;
  if (!adoptedCurrent?.isCurrent
      || adoptedCurrent.changeSetId !== candidate.changeSet.changeSetId) {
    throw new Error('adopted ChangeSet did not become the exact current Revision');
  }
  await loadTarget(window, config, targetForRevision(target, adoptedCurrent), 'adopted volcano reopen');
  await openMode(wc, '版本历史', 'history');
  onStage?.('volcano_history_open');
  const preRestoreLedger = await readFamilyLedger(wc, config, target);
  const restorableRevisions = preRestoreLedger.revisions.filter((revision) => revision?.isCurrent !== true);
  if (restorableRevisions.length === 0) {
    throw new Error(`history ledger has no restorable Revision (revisionCount=${preRestoreLedger.revisions.length})`);
  }
  const beforeRestoreOrdinal = await wc.executeJavaScript(`
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const versions = [...(panel?.innerText || '').matchAll(/v(\\d+)/g)]
        .map((match) => Number(match[1])).filter(Number.isFinite);
      return versions.length > 0 ? Math.max(...versions) : 0;
    })()
  `, true);
  await waitFor(wc,
    `[...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] button')]
      .some((item) => (item.textContent || '').trim() === '恢复为新版本' && !item.disabled)`,
    'historical restore action',
  );
  const restoreRequest = await wc.executeJavaScript(`
    (() => {
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const button = panel && [...panel.querySelectorAll('button')]
        .find((item) => (item.textContent || '').trim() === '恢复为新版本' && !item.disabled);
      const actionGroup = button?.closest('div[class]');
      const row = actionGroup?.parentElement;
      const rowText = row?.innerText || '';
      const ordinal = Number(rowText.match(/v(\\d+)/)?.[1] || 0);
      if (!button || !Number.isInteger(ordinal) || ordinal <= 0) return null;
      button.click();
      return { ordinal };
    })()
  `, true);
  if (!restoreRequest?.ordinal) throw new Error('historical restore action is unavailable');
  const sourceRevision = preRestoreLedger.revisions.find((revision) =>
    revision?.revisionOrdinal === restoreRequest.ordinal && revision?.isCurrent !== true);
  if (!sourceRevision) throw new Error('historical restore UI row was not bound to one persisted Revision');
  onStage?.('volcano_restore_requested');
  const restoreOutcome = await waitFor(wc, `
    (() => {
      const canvasMode = document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') || null;
      const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
      const alert = panel?.querySelector('[role="alert"]')?.textContent?.trim() || null;
      const versions = [...(panel?.innerText || '').matchAll(/v(\\d+)/g)]
        .map((match) => Number(match[1])).filter(Number.isFinite);
      const maxOrdinal = versions.length > 0 ? Math.max(...versions) : 0;
      if (alert) return { state: 'error', alert, canvasMode, maxOrdinal };
      if (canvasMode === 'result') return { state: 'activated', canvasMode, maxOrdinal };
      if (maxOrdinal > ${Number(beforeRestoreOrdinal) || 0}) {
        return { state: 'persisted_without_activation', canvasMode, maxOrdinal };
      }
      return null;
    })()
  `, 'historical restore outcome', RESTORE_WAIT_MS);
  if (restoreOutcome.state === 'error') {
    throw new Error(`historical restore failed: ${restoreOutcome.alert}`);
  }
  if (restoreOutcome.state !== 'activated') {
    throw new Error('historical restore persisted a new Revision but did not activate the result view');
  }
  onStage?.('volcano_restore_result_open');
  await waitFor(wc,
    `document.querySelector('[aria-label="用 Agent 修改当前结果"]')?.getAttribute('data-state') === 'ready'`,
    'restored context binding',
  );
  const restoredCapture = await waitForNewChangeSet(wc, config, target, tracker, 'adopted');
  const restoredLedger = await readFamilyLedger(wc, config, target);
  const current = restoredLedger.currentRevision;
  if (!current?.revisionId || current.changeSetId !== restoredCapture.changeSet.changeSetId
      || current.revisionOrdinal <= sourceRevision.revisionOrdinal || current.isCurrent !== true) {
    throw new Error('restored ChangeSet did not become the exact current Revision');
  }

  // Reopen through a fresh BrowserWindow navigation using the restored Job and
  // Artifact coordinate. This proves the current Revision and Composer context
  // survive a real renderer reload instead of only existing in React state.
  const reopenedTarget = {
    jobId: current.toolJobId,
    artifact: String(current.outputPath || '').split('/').pop() || current.artifactId,
    artifactFamilyId: target.artifactFamilyId,
  };
  const reopenedSnapshot = await loadTarget(window, config, reopenedTarget, 'restored volcano reopen');
  const reopenedInteraction = await readInteractionCoordinate(wc, config, reopenedTarget, current.revisionId);
  const contextQuery = new URLSearchParams({
    projectId: config.projectId,
    conversationId: config.conversationId,
    jobId: reopenedTarget.jobId,
    artifact: reopenedTarget.artifact,
    revisionId: current.revisionId,
  });
  const contextUrl = `${config.backendBaseUrl}/api/result-studio/context-envelope?${contextQuery.toString()}`;
  const reopenedContext = await wc.executeJavaScript(`
    fetch(${JSON.stringify(contextUrl)})
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'restored_context_unavailable');
        return data;
      })
  `, true);
  const exactContext = reopenedContext?.envelope?.revision?.revisionId === current.revisionId
    && reopenedContext.envelope.revision.currentRevisionId === current.revisionId
    && reopenedContext.envelope.revision.isCurrent === true
    && reopenedContext.envelope.job?.toolJobId === current.toolJobId
    && reopenedInteraction.revision.revisionId === current.revisionId
    && reopenedSnapshot.composerState === 'ready';
  if (!exactContext) throw new Error('restored result reopen did not recover the exact current context');
  onStage?.('volcano_restore_reopened');
  return {
    adopted: true,
    restoredAsNewRevision: true,
    resultingRevisionOrdinal: current.revisionOrdinal,
    candidate: candidate.binding,
    adoptedState: adoptedCapture.binding,
    sourceRevisionDigest: stableDigest(sourceRevision.revisionId),
    restored: restoredCapture.binding,
    reopened: {
      currentRevisionDigest: stableDigest(current.revisionId),
      currentJobDigest: stableDigest(current.toolJobId),
      exactContext,
      composerReady: reopenedSnapshot.composerState === 'ready',
      contextBindingDigest: stableDigest({
        revisionId: reopenedContext.envelope.revision.revisionId,
        currentRevisionId: reopenedContext.envelope.revision.currentRevisionId,
        toolJobId: reopenedContext.envelope.job.toolJobId,
      }),
    },
  };
}

async function adoptThenRevert(window, config, target, candidate, { onStage } = {}) {
  const wc = window.webContents;
  await clickButtonByText(wc, '采用此版本', 'panel');
  const adoptedCapture = await waitForKnownChangeSetStatus(
    wc, config, target, candidate.changeSet.changeSetId, 'adopted',
  );
  onStage?.('heatmap_presentation_adopted');
  const adoptedLedger = await readFamilyLedger(wc, config, target);
  const adoptedCurrent = adoptedLedger.currentRevision;
  if (!adoptedCurrent?.isCurrent
      || adoptedCurrent.changeSetId !== candidate.changeSet.changeSetId) {
    throw new Error('adopted ChangeSet did not become the exact current Revision');
  }
  await loadTarget(window, config, targetForRevision(target, adoptedCurrent), 'adopted heatmap reopen');
  await openMode(wc, '审查修改', 'compare');
  await selectExactReviewChangeSet(wc, candidate.changeSet.changeSetId);
  await waitFor(wc,
    `[...document.querySelectorAll('[aria-label="Result Studio 版本与变更"] button')]
      .some((item) => (item.textContent || '').trim() === '撤销本次采用' && !item.disabled)`,
    'adopted candidate revert action',
  );
  await clickButtonByText(wc, '撤销本次采用', 'panel');
  const revertedCapture = await waitForKnownChangeSetStatus(
    wc, config, target, candidate.changeSet.changeSetId, 'reverted',
  );
  onStage?.('heatmap_presentation_reverted');
  return {
    adopted: true,
    reverted: true,
    candidate: candidate.binding,
    adoptedState: adoptedCapture.binding,
    revertedState: revertedCapture.binding,
  };
}

async function discardCandidate(window, config, target, candidate) {
  const wc = window.webContents;
  await clickButtonByText(wc, '放弃候选', 'panel');
  const revertedCapture = await waitForKnownChangeSetStatus(
    wc, config, target, candidate.changeSet.changeSetId, 'reverted',
  );
  return { discarded: true, candidate: candidate.binding, revertedState: revertedCapture.binding };
}

async function useAdvancedDrawer(window, { field, value, outcome, scientific }) {
  const wc = window.webContents;
  const expanded = await wc.executeJavaScript(`
    (() => {
      const drawer = document.querySelector('details[aria-label="高级精细调整"]');
      if (!(drawer instanceof HTMLDetailsElement)) return false;
      drawer.open = true;
      drawer.dispatchEvent(new Event('toggle', { bubbles: true }));
      return drawer.open;
    })()
  `, true);
  if (!expanded) throw new Error('advanced drawer is unavailable');
  const selector = `#rs-edit-${field}`;
  if (scientific && field === 'method') await setSelectValue(wc, selector, value);
  else await setInputValue(wc, selector, value);
  await waitFor(wc,
    `document.querySelector('section[aria-label="结果编辑"] [role="status"]')?.getAttribute('data-science') === ${scientific ? '"true"' : '"false"'}`,
    scientific ? 'scientific impact acknowledgement' : 'presentation impact acknowledgement',
  );
  await setLabeledInputValue(wc, '这次修改想达到什么效果', outcome);
  if (scientific) {
    await setLabeledCheckbox(wc, '我已理解这会改变科学结论', true);
  }
  const beforeMessages = await wc.executeJavaScript(`document.querySelectorAll('.sc-msg-assistant').length`, true);
  await clickButtonByText(wc, '生成候选版本', 'advanced');
  return waitForAgentSettlement(wc, beforeMessages, {
    requiresResultProgress: true,
    expectedCompletion: '候选版本已经生成',
  });
}

async function readProjectJobs(webContents, config) {
  const jobs = await webContents.executeJavaScript(`
    fetch(${JSON.stringify(`${config.backendBaseUrl}/api/data/projects/${encodeURIComponent(config.projectId)}/jobs`)})
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('jobs_unavailable')))
      .then((data) => Array.isArray(data.jobs) ? data.jobs : [])
  `, true);
  return Array.isArray(jobs) ? jobs : [];
}

function jobBinding(job) {
  const artifactIds = canonicalIds((job?.result?.artifacts || []).map((artifact) => artifact?.id));
  const identity = { jobId: String(job?.id || ''), artifactIds };
  if (!identity.jobId || artifactIds.length === 0) throw new Error('completed Job has no Artifact identity');
  return {
    objectDigest: stableDigest(identity),
    jobDigest: stableDigest(identity.jobId),
    artifactSetDigest: stableDigest(artifactIds),
    artifactCount: artifactIds.length,
    status: String(job.status || ''),
  };
}

async function latestEnrichmentTarget(webContents, config, priorJobIds) {
  const jobs = await readProjectJobs(webContents, config);
  const candidates = jobs.filter((entry) => entry && entry.tool_id === 'go-kegg'
    && entry.status === 'completed' && !priorJobIds.has(entry.id));
  if (candidates.length !== 1) throw new Error('UI enrichment did not create exactly one completed GO/KEGG Job');
  const job = candidates[0];
  const artifactName = (artifactId) => {
    const artifact = (job.result?.artifacts || []).find((entry) => entry?.id === artifactId);
    const value = artifact?.filename || artifact?.name || artifact?.path || '';
    return String(value).split(/[\\/]/).pop() || '';
  };
  const target = {
    jobId: String(job.id),
    artifact: artifactName('go_bp_results'),
  };
  if (!target.artifact) throw new Error('UI enrichment Job has no formal GO table');
  return { target, job, binding: jobBinding(job), artifactName };
}

async function inspectEnrichmentUi(window, config, priorJobIds) {
  const wc = window.webContents;
  const enrichment = await latestEnrichmentTarget(wc, config, priorJobIds);
  const { target } = enrichment;
  await loadTarget(window, config, target, 'GO enrichment');
  const go = await semanticSnapshot(wc);
  const goCoordinate = await readInteractionCoordinate(wc, config, target);
  const keggArtifact = enrichment.artifactName('kegg_results');
  let kegg = { tablePresent: false, bodyVisible: false, domSha256: null };
  if (keggArtifact) {
    const keggTarget = { ...target, artifact: keggArtifact };
    await loadTarget(window, config, keggTarget, 'KEGG enrichment');
    kegg = await semanticSnapshot(wc);
    const keggCoordinate = await readInteractionCoordinate(wc, config, keggTarget);
    if (keggCoordinate.revision.changeSetId !== goCoordinate.revision.changeSetId) {
      throw new Error('GO and KEGG UI artifacts did not resolve to one formal cohort');
    }
  }
  if (!go.tablePresent || !go.bodyVisible || (keggArtifact && (!kegg.tablePresent || !kegg.bodyVisible))) {
    throw new Error('formal GO/KEGG table was not visible in the Electron result surface');
  }
  const familyTarget = { ...target, artifactFamilyId: goCoordinate.revision.artifactFamilyId };
  const familyLedger = await readFamilyLedger(wc, config, familyTarget);
  const cohort = boundChangeSetFromLedger(familyLedger, goCoordinate.revision.changeSetId);
  if (!cohort) throw new Error('enrichment UI was not bound to one formal baseline ChangeSet');
  return {
    goTableVisible: go.tablePresent && go.bodyVisible,
    keggTableVisible: kegg.tablePresent === true && kegg.bodyVisible === true,
    keggFormalArtifactPresent: Boolean(keggArtifact),
    goDomSha256: go.domSha256,
    keggDomSha256: kegg.domSha256,
    job: enrichment.binding,
    cohort: cohort.binding,
  };
}

function projectionAudit(...snapshots) {
  const flags = snapshots.map((snapshot) => snapshot?.internalLeakFlags || {});
  return {
    absoluteCoordinate: flags.some((item) => item.absolutePath === true),
    accessMaterialPattern: flags.some((item) => item.credential === true),
    internalIdentifier: flags.some((item) => item.rawInternalId === true),
  };
}

function projectionAuditByStage(stages) {
  return Object.fromEntries(Object.entries(stages)
    .map(([stage, snapshot]) => [stage, projectionAudit(snapshot)]));
}

function projectionDiagnosticsByStage(stages) {
  return Object.fromEntries(Object.entries(stages).map(([stage, snapshot]) => [stage, {
    absolutePathLocations: Array.isArray(snapshot?.internalLeakFlags?.absolutePathLocations)
      ? snapshot.internalLeakFlags.absolutePathLocations
      : [],
  }]));
}

async function run() {
  const config = readConfig();
  mkdirSync(config.outputDir, { recursive: true });
  let stage = 'starting';
  const diagnostics = [];
  const pushDiagnostic = (entry) => {
    diagnostics.push(entry);
    if (diagnostics.length > 30) diagnostics.shift();
  };
  const checkpoint = (nextStage) => {
    stage = nextStage;
    writeFileSync(config.resultPath, `${JSON.stringify({ schemaVersion: 1, passed: false, stage })}\n`);
  };
  checkpoint('starting');

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: config.show === true,
    title: 'BioF3 P6 UI-110 isolated trace',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    pushDiagnostic({ type: 'console', level, message: String(message || '').slice(0, 1200), line, sourceId: String(sourceId || '').slice(-300) });
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    pushDiagnostic({ type: 'did-fail-load', errorCode, errorDescription, validatedUrl, isMainFrame });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    pushDiagnostic({ type: 'render-process-gone', reason: details?.reason || null, exitCode: details?.exitCode || null });
  });

  try {
    const initialDeg = await loadTarget(window, config, config.targets.deg, 'DEG baseline');
    const initialDegCapture = await captureScreenshot(window, config.outputDir, 'deg-baseline');
    const degTracker = familyTracker(await readFamilyLedger(window.webContents, config, config.targets.deg));
    checkpoint('deg_ready');

    await loadTarget(window, config, config.targets.volcano, 'volcano baseline');
    const volcanoTracker = familyTracker(await readFamilyLedger(window.webContents, config, config.targets.volcano));
    checkpoint('volcano_loaded');
    const selectedVolcanoGenes = await selectRows(window.webContents, config, config.targets.volcano, 3);
    checkpoint('volcano_selected');
    const volcanoRun = await submitComposer(window, '把火山图的点放大，并标注当前选择的基因。', { requiresResultProgress: true });
    checkpoint('volcano_agent_settled');
    await reloadForCandidate(window, config, config.targets.volcano, 'volcano');
    const volcanoCandidate = await waitForNewChangeSet(
      window.webContents, config, config.targets.volcano, volcanoTracker, 'preview_ready',
    );
    checkpoint('volcano_candidate_ready');
    const volcanoCompare = await reviewCandidate(
      window, config, volcanoCandidate, { visual: true, presentation: true },
    );
    checkpoint('volcano_compared');
    const volcanoCompareCapture = await captureScreenshot(window, config.outputDir, 'volcano-compare');
    checkpoint('volcano_captured');
    const volcanoLifecycle = await adoptThenRestore(
      window, config, config.targets.volcano, volcanoTracker, volcanoCandidate, { onStage: checkpoint },
    );
    checkpoint('volcano_lifecycle_complete');

    await loadTarget(window, config, config.targets.heatmap, 'heatmap baseline');
    const heatmapTracker = familyTracker(await readFamilyLedger(window.webContents, config, config.targets.heatmap));
    checkpoint('heatmap_presentation_loaded');
    const heatmapPresentationRun = await submitComposer(window, '把热图配色改得更易区分，并显示相关系数数值。', { requiresResultProgress: true });
    checkpoint('heatmap_presentation_agent_settled');
    await reloadForCandidate(window, config, config.targets.heatmap, 'heatmap presentation');
    const heatmapPresentationCandidate = await waitForNewChangeSet(
      window.webContents, config, config.targets.heatmap, heatmapTracker, 'preview_ready',
    );
    checkpoint('heatmap_presentation_candidate_ready');
    const heatmapPresentationCompare = await reviewCandidate(
      window, config, heatmapPresentationCandidate, { presentation: true, visual: true },
    );
    checkpoint('heatmap_presentation_compared');
    const heatmapPresentationLifecycle = await adoptThenRevert(
      window, config, config.targets.heatmap, heatmapPresentationCandidate, { onStage: checkpoint },
    );
    checkpoint('heatmap_presentation_complete');

    await loadTarget(window, config, config.targets.heatmap, 'heatmap scientific baseline');
    checkpoint('heatmap_scientific_loaded');
    const heatmapScientificRun = await useAdvancedDrawer(window, {
      field: 'method', value: 'spearman', scientific: true,
      outcome: '将相关性方法改为 Spearman 并重新计算。',
    });
    checkpoint('heatmap_scientific_agent_settled');
    await reloadForCandidate(window, config, config.targets.heatmap, 'heatmap scientific');
    const heatmapScientificCandidate = await waitForNewChangeSet(
      window.webContents, config, config.targets.heatmap, heatmapTracker, 'preview_ready',
    );
    checkpoint('heatmap_scientific_candidate_ready');
    const heatmapScientificCompare = await reviewCandidate(
      window, config, heatmapScientificCandidate, { scientific: true, visual: true },
    );
    checkpoint('heatmap_scientific_compared');
    const heatmapScientificCapture = await captureScreenshot(window, config.outputDir, 'heatmap-scientific-compare');
    const heatmapScientificDiscarded = await discardCandidate(
      window, config, config.targets.heatmap, heatmapScientificCandidate,
    );
    checkpoint('heatmap_scientific_complete');

    await loadTarget(window, config, config.targets.deg, 'DEG scientific baseline');
    checkpoint('threshold_loaded');
    const thresholdRun = await useAdvancedDrawer(window, {
      field: 'lfc_cutoff', value: config.changedLfc, scientific: true,
      outcome: `将 LFC 阈值改为 ${config.changedLfc}，重新计算受影响的下游富集结果。`,
    });
    checkpoint('threshold_agent_settled');
    await reloadForCandidate(window, config, config.targets.deg, 'DEG threshold');
    const thresholdCandidate = await waitForNewChangeSet(
      window.webContents, config, config.targets.deg, degTracker, 'preview_ready',
    );
    checkpoint('threshold_candidate_ready');
    const thresholdCompare = await reviewCandidate(
      window, config, thresholdCandidate, { deg: true, enrichment: true, scientific: true },
    );
    checkpoint('threshold_compared');
    const thresholdCompareCapture = await captureScreenshot(window, config.outputDir, 'deg-threshold-compare');
    checkpoint('threshold_scientific_complete');

    // Keep the direct UI-derived enrichment after the threshold subgraph
    // trace. P5's current affected-subgraph executor intentionally admits one
    // formal direct GO/KEGG child; adding another child first would change the
    // scientific task under test instead of exercising the same path.
    await loadTarget(window, config, config.targets.deg, 'DEG enrichment baseline');
    checkpoint('enrichment_loaded');
    const selectedGenes = await selectRows(window.webContents, config, config.targets.deg, 3);
    checkpoint('enrichment_selected');
    const jobsBeforeEnrichment = new Set((await readProjectJobs(window.webContents, config))
      .map((job) => job?.id).filter(Boolean));
    const enrichmentRun = await submitComposer(window, '用当前差异基因做 GO 和 KEGG 富集。');
    checkpoint('enrichment_agent_settled');
    const enrichmentUi = await inspectEnrichmentUi(window, config, jobsBeforeEnrichment);
    checkpoint('enrichment_ui_complete');

    const finalSnapshot = await semanticSnapshot(window.webContents);
    const publicProjectionAudit = projectionAuditByStage({
      initial: initialDeg,
      volcano: volcanoCompare,
      heatmapPresentation: heatmapPresentationCompare,
      heatmapScientific: heatmapScientificCompare,
      threshold: thresholdCompare,
      final: finalSnapshot,
    });
    const publicProjectionDiagnostics = projectionDiagnosticsByStage({
      initial: initialDeg,
      volcano: volcanoCompare,
      heatmapPresentation: heatmapPresentationCompare,
      heatmapScientific: heatmapScientificCompare,
      threshold: thresholdCompare,
      final: finalSnapshot,
    });
    const result = {
      schemaVersion: 1,
      renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      initialDeg: {
        bodyVisible: initialDeg.bodyVisible,
        composerReady: initialDeg.composerState === 'ready',
        tablePresent: initialDeg.tablePresent,
        domSha256: initialDeg.domSha256,
        ...initialDegCapture,
      },
      enrichment: {
        selectedGenes: selectedGenes.count,
        selectionBinding: selectedGenes,
        agentSettled: enrichmentRun.assistantMessageCount > 0,
        goTableVisible: enrichmentUi.goTableVisible,
        keggTableVisible: enrichmentUi.keggTableVisible,
        keggFormalArtifactPresent: enrichmentUi.keggFormalArtifactPresent,
        goDomSha256: enrichmentUi.goDomSha256,
        keggDomSha256: enrichmentUi.keggDomSha256,
        jobBinding: enrichmentUi.job,
        cohortBinding: enrichmentUi.cohort,
      },
      volcano: {
        selectedGenes: selectedVolcanoGenes.count,
        selectionBinding: selectedVolcanoGenes,
        resultProgressSeen: volcanoRun.sawProgress,
        visualCompareVisible: volcanoCompare.visualImageCount >= 2,
        presentationImpactVisible: volcanoCompare.impactPresentationVisible,
        adopted: volcanoLifecycle.adopted,
        restoredAsNewRevision: volcanoLifecycle.restoredAsNewRevision,
        resultingRevisionOrdinal: volcanoLifecycle.resultingRevisionOrdinal,
        lifecycleBinding: {
          candidate: volcanoLifecycle.candidate,
          adoptedState: volcanoLifecycle.adoptedState,
          sourceRevisionDigest: volcanoLifecycle.sourceRevisionDigest,
          restored: volcanoLifecycle.restored,
          reopened: volcanoLifecycle.reopened,
        },
        scientificSummary: volcanoCompare.scientificSummary,
        visibleScientificSummary: volcanoCompare.visibleScientificSummary,
        ...volcanoCompareCapture,
      },
      heatmap: {
        presentation: {
          resultProgressSeen: heatmapPresentationRun.sawProgress,
          visualCompareVisible: heatmapPresentationCompare.visualImageCount >= 2,
          presentationImpactVisible: heatmapPresentationCompare.impactPresentationVisible,
          adopted: heatmapPresentationLifecycle.adopted,
          reverted: heatmapPresentationLifecycle.reverted,
          lifecycleBinding: {
            candidate: heatmapPresentationLifecycle.candidate,
            adoptedState: heatmapPresentationLifecycle.adoptedState,
            revertedState: heatmapPresentationLifecycle.revertedState,
          },
        },
        scientific: {
          resultProgressSeen: heatmapScientificRun.sawProgress,
          scientificImpactVisible: heatmapScientificCompare.impactScientificVisible,
          visualCompareVisible: heatmapScientificCompare.visualImageCount >= 2,
          discarded: heatmapScientificDiscarded.discarded,
          lifecycleBinding: {
            candidate: heatmapScientificDiscarded.candidate,
            revertedState: heatmapScientificDiscarded.revertedState,
          },
          scientificSummary: heatmapScientificCompare.scientificSummary,
          visibleScientificSummary: heatmapScientificCompare.visibleScientificSummary,
          ...heatmapScientificCapture,
        },
      },
      threshold: {
        resultProgressSeen: thresholdRun.sawProgress,
        degDifferenceVisible: thresholdCompare.degDifferenceVisible,
        enrichmentRankAndDirectionVisible: thresholdCompare.enrichmentRankAndDirectionVisible,
        executionNodesVisible: thresholdCompare.executionNodesVisible,
        scientificImpactVisible: thresholdCompare.impactScientificVisible,
        candidateBinding: thresholdCandidate.binding,
        scientificSummary: thresholdCompare.scientificSummary,
        visibleScientificSummary: thresholdCompare.visibleScientificSummary,
        ...thresholdCompareCapture,
      },
      final: {
        canvasPresent: finalSnapshot.canvasPresent,
        bodyVisible: finalSnapshot.bodyVisible,
        composerReady: finalSnapshot.composerState === 'ready',
        domSha256: finalSnapshot.domSha256,
      },
      publicProjectionAudit,
      publicProjectionDiagnostics,
      noSensitiveProjection: Object.values(publicProjectionAudit)
        .every((stage) => Object.values(stage).every((value) => value === false)),
    };
    result.passed = result.initialDeg.bodyVisible
      && result.initialDeg.composerReady
      && result.enrichment.selectedGenes > 0
      && result.enrichment.selectionBinding?.exact === true
      && result.enrichment.agentSettled
      && result.enrichment.goTableVisible
      && (!result.enrichment.keggFormalArtifactPresent || result.enrichment.keggTableVisible)
      && result.enrichment.jobBinding?.status === 'completed'
      && result.enrichment.cohortBinding?.status === 'adopted'
      && result.volcano.resultProgressSeen
      && result.volcano.selectionBinding?.exact === true
      && result.volcano.visualCompareVisible
      && result.volcano.presentationImpactVisible
      && result.volcano.adopted
      && result.volcano.restoredAsNewRevision
      && result.volcano.lifecycleBinding?.reopened?.exactContext
      && result.volcano.lifecycleBinding?.candidate?.objectDigest
        === result.volcano.lifecycleBinding?.adoptedState?.objectDigest
      && result.heatmap.presentation.resultProgressSeen
      && result.heatmap.presentation.presentationImpactVisible
      && result.heatmap.presentation.adopted
      && result.heatmap.presentation.reverted
      && result.heatmap.presentation.lifecycleBinding?.candidate?.objectDigest
        === result.heatmap.presentation.lifecycleBinding?.revertedState?.objectDigest
      && result.heatmap.scientific.resultProgressSeen
      && result.heatmap.scientific.scientificImpactVisible
      && result.heatmap.scientific.discarded
      && result.heatmap.scientific.lifecycleBinding?.candidate?.objectDigest
        === result.heatmap.scientific.lifecycleBinding?.revertedState?.objectDigest
      && result.threshold.resultProgressSeen
      && result.threshold.degDifferenceVisible
      && result.threshold.enrichmentRankAndDirectionVisible
      && result.threshold.executionNodesVisible
      && result.threshold.scientificImpactVisible
      && result.threshold.candidateBinding?.status === 'preview_ready'
      && result.threshold.scientificSummary?.artifactCount >= 2
      && result.threshold.visibleScientificSummary?.sectionCount >= 2
      && result.final.canvasPresent
      && result.final.bodyVisible
      && result.final.composerReady
      && result.noSensitiveProjection;
    writeFileSync(config.resultPath, `${JSON.stringify(result, null, 2)}\n`);
    window.destroy();
  } catch (error) {
    // This file lives only in the disposable capture directory and is never
    // copied into canonical evidence. It makes renderer-only failures
    // diagnosable without expanding the public evidence surface.
    let pageState = null;
    let volcanoLedger = null;
    try {
      pageState = await window.webContents.executeJavaScript(`
        (() => {
          const panel = document.querySelector('[aria-label="Result Studio 版本与变更"]');
          const buttons = [...(panel?.querySelectorAll('button') || [])];
          return {
            canvasMode: document.querySelector('[aria-label="结果主画布"]')?.getAttribute('data-mode') || null,
            panelMode: panel?.getAttribute('data-mode') || null,
            panelPresent: Boolean(panel),
            panelTextLength: panel ? (panel.innerText || '').length : 0,
            historyRowCount: panel?.querySelectorAll('strong').length || 0,
            restoreButtonCount: buttons.filter((item) => (item.textContent || '').trim() === '恢复为新版本').length,
            enabledRestoreButtonCount: buttons.filter((item) => (item.textContent || '').trim() === '恢复为新版本' && !item.disabled).length,
            modeControlCount: [...document.querySelectorAll('[aria-label="结果视图"] button')].length,
          };
        })()
      `, true);
    } catch {}
    try {
      const ledger = await readFamilyLedger(window.webContents, config, config.targets.volcano);
      volcanoLedger = {
        revisionCount: ledger.revisions.length,
        currentCount: ledger.revisions.filter((revision) => revision?.isCurrent === true).length,
        restorableCount: ledger.revisions.filter((revision) => revision?.isCurrent !== true).length,
        ordinals: ledger.revisions.map((revision) => revision?.revisionOrdinal).filter(Number.isInteger).sort((a, b) => a - b),
        changeSetStatuses: ledger.changeSets.map((changeSet) => changeSet?.status).filter(Boolean).sort(),
      };
    } catch {}
    writeFileSync(path.join(config.outputDir, 'driver-debug.json'), `${JSON.stringify({
      stage,
      errorName: error?.name || null,
      errorMessage: error && error.message ? error.message : String(error),
      pageState,
      volcanoLedger,
      diagnostics,
    }, null, 2)}\n`);
    writeFileSync(config.resultPath, `${JSON.stringify({
      schemaVersion: 1,
      passed: false,
      stage,
      error: error && error.message ? error.message : String(error),
    }, null, 2)}\n`);
    throw error;
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
