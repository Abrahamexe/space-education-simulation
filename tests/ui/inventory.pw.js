// UI inventory (spec: docs/superpowers/specs/2026-11-25-arayuz-yenileme-design.md).
// Every control, panel and shortcut the interface had before the redesign must still be reachable.
// Each entry passes when ANY of its selectors is visible: old and new places are both listed, so the
// check holds before, during and after the move. Run through the Playwright MCP tool:
//   browser_run_code_unsafe { filename: "tests/ui/inventory.pw.js" }   (dev server on :5173)
// Set `page.__mobile = true` beforehand for the 390×844 pass.
async (page) => {
  const mobile = !!page.__mobile;
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 });
  await page.goto('http://localhost:5173/?inventory=' + Date.now());
  await page.waitForFunction(() => window.__space && window.__space.views, null, { timeout: 60000 });
  await page.waitForTimeout(5000);

  const missing = [];
  let checked = 0;
  const vis = async (sel) => {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return true;
    return false;
  };
  const has = async (view, name, any) => {
    checked++;
    for (const s of any) if (await vis(s)) return true;
    missing.push(`${view}: ${name}`);
    return false;
  };
  const attr = (sel, a) => page.evaluate(([s, a]) => document.querySelector(s)?.getAttribute(a) ?? null, [sel, a]);
  const key = async (view, name, k, sel, a) => {
    checked++;
    const before = await attr(sel, a);
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
    const after = await attr(sel, a);
    if (before === after) missing.push(`${view}: kısayol ${k} (${name})`);
    await page.keyboard.press(k); // restore
    await page.waitForTimeout(250);
  };
  const click = async (any) => {
    for (const s of any) {
      const loc = page.locator(s);
      const n = await loc.count();
      for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i).evaluate((el) => el.click());
    }
  };
  const esc = () => page.keyboard.press('Escape').then(() => page.waitForTimeout(300));

  // ---- Solar system -------------------------------------------------------------------------
  const S = 'solar';
  await has(S, 'marka', ['.brand']);
  if (!mobile) await has(S, 'canlı okuma', ['.readout']);
  if (!mobile) await has(S, 'geliştirici', ['.dev-toggle']);
  await has(S, 'ara', ['.search-trigger']);
  for (const [i, n] of ['Galaktik', 'Yaşanabilir bölge', 'Yörüngeler', 'Etiketler'].entries())
    await has(S, `katman ${n}`, [`.layers .layer:has-text("${n}")`, `.layers .layer[title^="${n}"]`, `[data-view-menu]`]);
  if (!mobile) for (const n of ['Uzay araçları', 'Kuşaklar']) await has(S, `katman ${n}`, [`.layers .layer[title^="${n}"]`]);
  await has(S, 'yardım', ['.help > .btn-icon']);
  await has(S, 'ayarlar', ['.settings > .btn-icon']);
  for (const id of ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
    await has(S, `gezinme ${id}`, [`.nav-item[data-id="${id}"]`]);
  await has(S, 'uzay araçları menüsü', ['.nav-craft']);
  for (const a of ['slower', 'play', 'faster', 'now']) await has(S, `zaman ${a}`, [`.time [data-act="${a}"]`]);
  await has(S, 'tarih', ['.time-date']);
  await has(S, 'hız', ['.time-rate']);
  await has(S, 'Sinematik/Gerçek', ['.tools .segmented[role="radiogroup"] >> nth=0']);
  await has(S, 'Yörünge/Serbest', ['.tools .segmented >> nth=1']);
  await has(S, 'oyun alanı', ['.pg-launch']);
  await has(S, 'galaksiye çık', ['.tools .btn-icon[aria-label="Galaksiye çık"]', '[data-level="milkyWay"]']);
  await has(S, 'genel görünüm', ['.tools .btn-icon[aria-label="Genel görünüm"]', '[data-home]']);
  await key(S, 'yörüngeler', 'y', '.layers .layer[title^="Yörüngeler"]', 'aria-pressed');
  await key(S, 'etiketler', 'e', '.layers .layer[title^="Etiketler"]', 'aria-pressed');
  await key(S, 'yaşanabilir bölge', 'b', '.layers .layer[title^="Yaşanabilir"]', 'aria-pressed');
  await key(S, 'zaman', 'Space', '.time [data-act="play"]', 'data-playing');
  await key(S, 'kamera', 'm', '.tools .segmented >> nth=1', 'class').catch(() => {});

  // Info panel (Mars).
  await click(['.nav-item[data-id="mars"]']);
  await page.waitForTimeout(4500);
  const P = 'bilgi paneli';
  await has(P, 'panel', ['.panel']);
  await has(P, 'kapat', ['.panel-close']);
  await has(P, 'başlık', ['.panel-title']);
  await has(P, 'tür', ['.panel-type']);
  await has(P, 'yaklaş', ['.panel-actions [data-fly]']);
  await has(P, 'uydular', ['.moons .pill']);
  await has(P, 'Güneşe uzaklık', ['.panel-live [data-live="d"]']);
  await has(P, 'istatistikler', ['.panel .stats']);
  checked++;
  const deep = await page.evaluate(() => ['.compare', '.prose', '.fact', '.panel-src'].filter((s) => !document.querySelector(`.panel ${s}`)));
  deep.forEach((s) => missing.push(`${P}: ${s}`));

  // Popovers.
  await click(['.settings > .btn-icon']);
  await page.waitForTimeout(300);
  await has('ayarlar', 'kalite', ['.settings .popover .segmented:not([data-size]) button']);
  await has('ayarlar', 'otomatik', ['.settings [data-auto]']);
  await has('ayarlar', 'arayüz boyutu', ['.settings [data-size] button']);
  await esc();
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  await has('arama', 'arama kutusu', ['.search-dialog input']);
  await esc();
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  await has('yardım', 'kontroller', ['.help-pop']);
  await esc();
  await click(['.nav-craft']);
  await page.waitForTimeout(300);
  await has('uzay araçları', 'liste', ['.craft-menu .craft-option']);
  await esc();
  await click(['.panel-close']);
  await page.waitForTimeout(500);

  // ---- Galaxy ------------------------------------------------------------------------------------
  await page.evaluate(() => window.__space.views.goToGalaxy());
  await page.waitForFunction(() => window.__space.views.galaxy.active, null, { timeout: 40000 });
  await page.waitForTimeout(8000);
  const G = 'galaksi';
  await has(G, 'güneş sistemine dön', ['.galaxy-hud:not(.universe-hud) [data-back]', '[data-level="solar"]']);
  await has(G, 'keşfet', ['.galaxy-hud [data-explore]', '.galaxy-explore']);
  await has(G, 'evrene çık', ['.galaxy-hud [data-universe]', '[data-level="local"]']);
  await has(G, 'durdur', ['.galaxy-hud:not(.universe-hud) [data-pause]']);
  await has(G, 'hız', ['.galaxy-hud [data-speed]']);
  if (!mobile) await has(G, 'uzaklık', ['.galaxy-hud:not(.universe-hud) .galaxy-readout']);
  await has(G, 'yörüngeler', ['.galaxy-hud:not(.universe-hud) [data-orbits]']);
  await has(G, 'etiketler', ['.galaxy-hud:not(.universe-hud) [data-labels]']);
  await has(G, 'kamera', ['.galaxy-cam']);
  await has(G, 'yaşanabilir', ['.galaxy-hud [data-hz]']);
  await has(G, 'Samanyolu hakkında', ['.galaxy-hud:not(.universe-hud) [data-info]']);
  await has(G, 'genel görünüm', ['.galaxy-hud [data-overview]']);
  await has(G, 'kaynaklar', ['.galaxy-hud:not(.universe-hud) .galaxy-credit']);
  await key(G, 'etiketler', 'e', '.galaxy-hud:not(.universe-hud) [data-labels]', 'aria-pressed');
  await key(G, 'yörüngeler', 'y', '.galaxy-hud:not(.universe-hud) [data-orbits]', 'aria-pressed');
  const exploreOpen = await attr('.galaxy-explore', 'data-open');
  if (exploreOpen !== 'true') {
    await page.keyboard.press('k');
    await page.waitForTimeout(600);
  }
  await has(G, 'keşfet arama', ['.galaxy-explore .xp-search, .galaxy-explore input']);
  await has(G, 'keşfet sekmeleri', ['.galaxy-explore [role="tab"], .galaxy-explore .xp-order, .galaxy-explore .segmented button']);
  await has(G, 'keşfet satırları', ['.galaxy-explore .xp-item']);
  if (exploreOpen !== 'true') await esc();
  await click(['.galaxy-hud:not(.universe-hud) [data-info]']);
  await page.waitForTimeout(500);
  await has(G, 'Samanyolu kartı', ['.galaxy-hud:not(.universe-hud) .galaxy-card']);

  // ---- Universe ----------------------------------------------------------------------------------
  await page.evaluate(() => window.__space.views.goToUniverse());
  await page.waitForFunction(() => window.__space.views.inUniverse, null, { timeout: 40000 });
  await page.waitForTimeout(3500);
  const U = 'evren';
  await has(U, 'galaksiye dön', ['.universe-hud [data-back]', '[data-level="milkyWay"]']);
  for (const id of ['local', 'laniakea', 'web', 'observable']) await has(U, `ölçek ${id}`, [`.universe-hud [data-scale="${id}"]`]);
  if (!mobile) await has(U, 'uzaklık', ['.universe-hud .galaxy-readout']);
  await has(U, 'sinematik/bilimsel', ['.universe-hud [data-look="cinematic"]']);
  await has(U, 'katmanlar', ['.universe-hud [data-layers]']);
  await has(U, 'bileşim', ['.universe-hud [data-composition]']);
  await has(U, 'oluşum', ['.universe-hud [data-sim]']);
  await has(U, 'laboratuvar', ['.universe-hud [data-lab]']);
  await has(U, 'film', ['.universe-hud [data-film]']);
  await has(U, 'kanıtlar', ['.universe-hud [data-evidence-btn]']);
  await has(U, 'etiketler', ['.universe-hud [data-labels]']);
  await has(U, 'bu harita nedir', ['.universe-hud [data-info]']);
  await has(U, 'kaynaklar', ['.universe-hud .galaxy-credit']);
  await click(['.universe-hud [data-layers]']);
  await page.waitForTimeout(300);
  for (const l of ['galaxies', 'darkMatter', 'gas', 'flow', 'basin']) await has(U, `katman ${l}`, [`.universe-hud [data-layer="${l}"]`]);
  await click(['.universe-hud [data-layers]']);
  await click(['.universe-hud [data-evidence-btn]']);
  await page.waitForTimeout(300);
  await has(U, 'kanıt listesi', ['.universe-hud [data-evidence]']);
  await click(['.universe-hud [data-evidence-btn]']);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await page.waitForTimeout(1200);
  await has('laboratuvar', 'pencere', ['.lab[data-open="true"]']);
  await has('laboratuvar', 'kapat', ['.lab [data-lab-close]']);
  await click(['.lab [data-lab-close]']);
  await page.waitForTimeout(500);

  return { ok: missing.length === 0, missing, checked, mobile };
}
