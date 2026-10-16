// Phloem landing v2: WebGL hero gallery driven by scroll, scroll-sliced email, 3D template ring, tilt, reveal, counters.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  // ---------- nav, progress ----------
  const nav = document.getElementById('nav');
  const bar = document.querySelector('#progress i');
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
    const max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.width = `${(max > 0 ? window.scrollY / max : 0) * 100}%`;
  };
  onScroll(); addEventListener('scroll', onScroll, { passive: true });

  // ---------- reveal ----------
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  const fan = document.getElementById('fan');
  if (fan) new IntersectionObserver((es) => { for (const e of es) fan.classList.toggle('in', e.isIntersecting); }, { threshold: 0.3 }).observe(fan);

  // ---------- counters ----------
  const cio = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target, target = Number(el.dataset.count), start = performance.now();
      const step = (now) => { const p = Math.min(1, (now - start) / 900); el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); cio.unobserve(el);
    }
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));

  // ---------- tilt ----------
  if (fine && !reduce) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      card.addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; card.style.transform = `perspective(900px) rotateX(${-y * 8}deg) rotateY(${x * 10}deg) translateY(-4px)`; });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  // ---------- scroll progress helper ----------
  const progressOf = (track) => { const r = track.getBoundingClientRect(); const total = track.offsetHeight - innerHeight; return clamp(-r.top / Math.max(1, total), 0, 1); };

  // ---------- HERO: product story (laptop → pick → recolor → slice → draft) ----------
  const stage = document.getElementById('stage');
  if (stage) {
    const $ = (id) => document.getElementById(id);
    const hero = $('hero'), laptop = $('laptop'), cur = $('cur'), fly = $('fly'), phone = $('phone'), toast = $('toast'), toast2 = $('toast2');
    const uiPick = $('uiPick'), uiMail = $('uiMail'), uiSw = $('uiSw'), uiExport = $('uiExport'), uiCanvas = $('uiCanvas');
    const steps = Array.from(document.querySelectorAll('#storySteps li'));
    if (fine && !reduce) {
      hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; laptop.style.transform = `rotateY(${14 + x * 10}deg) rotateX(${4 - y * 7}deg)`; });
      hero.addEventListener('pointerleave', () => { laptop.style.transform = ''; });
    }
    const stageWrap = stage.parentElement, heroCopy = $('heroCopy');
    if (!reduce) {
      const heroScroll = () => {
        const r = hero.getBoundingClientRect(); const p = clamp(-r.top / (r.height * 0.85), 0, 1), e = p * p;
        stageWrap.style.transform = `perspective(1400px) rotateX(${e * 26}deg) translateY(${e * 110}px) scale(${1 - e * 0.14})`; stageWrap.style.opacity = String(1 - e * 0.9);
        heroCopy.style.transform = `translateY(${-p * 70}px)`; heroCopy.style.opacity = String(1 - e * 0.95);
      };
      heroScroll(); addEventListener('scroll', heroScroll, { passive: true });
    }
    const rel = (el, ax = 0.5, ay = 0.5) => { const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - s.left + r.width * ax, y: r.top - s.top + r.height * ay }; };
    const moveTo = (el, ax, ay) => { const p = rel(el, ax, ay); cur.style.transform = `translate(${p.x - 4}px, ${p.y - 3}px)`; };
    const click = () => { cur.classList.remove('click'); void cur.offsetWidth; cur.classList.add('click'); };
    const setStep = (n) => { stage.dataset.step = String(n); steps.forEach((li, i) => { li.classList.toggle('on', i === n - 1); li.classList.toggle('done', i < n - 1); }); };
    const reset = () => {
      stage.classList.remove('has-mail', 'sel', 'scan', 'cuts', 'dim-mail'); stage.style.setProperty('--hue', '0deg');
      uiPick.classList.remove('sel'); uiSw.classList.remove('sel'); uiExport.classList.remove('press');
      fly.className = 'fly'; fly.style.transform = ''; phone.classList.remove('on'); toast.classList.remove('on'); toast2.classList.remove('on'); setStep(0);
    };
    const placeFly = () => { const s = stage.getBoundingClientRect(), r = uiMail.getBoundingClientRect(); fly.style.left = `${r.left - s.left}px`; fly.style.top = `${r.top - s.top}px`; fly.style.width = `${r.width}px`; };
    const launchFly = () => {
      const r = uiMail.getBoundingClientRect(), p = phone.getBoundingClientRect();
      const dx = (p.left + p.width / 2) - (r.left + r.width / 2), dy = (p.top + p.height * 0.45) - (r.top + r.height / 2), sc = (p.width * 0.86) / r.width;
      fly.style.transform = `translate(${dx}px, ${dy}px) rotateY(-28deg) scale(${sc})`;
    };
    let timers = [], running = false, visible = false;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const stop = () => { timers.forEach(clearTimeout); timers = []; running = false; };
    const play = () => {
      stop(); reset(); running = true;
      const c = rel(uiCanvas); cur.style.transition = 'none'; cur.style.transform = `translate(${c.x + 30}px, ${c.y + 50}px)`; void cur.offsetWidth; cur.style.transition = '';
      at(500, () => moveTo(uiPick, 0.5, 0.5));
      at(1300, () => { click(); uiPick.classList.add('sel'); stage.classList.add('has-mail'); setStep(1); });
      at(2400, () => moveTo(uiMail, 0.5, 0.17));
      at(3100, () => { click(); stage.classList.add('sel'); });
      at(3800, () => moveTo(uiSw, 0.5, 0.5));
      at(4500, () => { click(); uiSw.classList.add('sel'); stage.style.setProperty('--hue', '200deg'); setStep(2); });
      at(5500, () => moveTo(uiExport, 0.5, 0.5));
      at(6200, () => { click(); uiExport.classList.add('press'); stage.classList.remove('sel'); stage.classList.add('scan'); setStep(3); });
      at(6500, () => stage.classList.add('cuts'));
      at(7300, () => { placeFly(); fly.classList.add('show'); stage.classList.add('dim-mail'); uiExport.classList.remove('press'); });
      at(7450, launchFly);
      at(8300, () => phone.classList.add('on'));
      at(8500, () => { fly.classList.add('gone'); toast.classList.add('on'); setStep(4); });
      at(9200, () => toast2.classList.add('on'));
      at(12500, () => { running = false; if (visible) play(); });
    };
    if (reduce) {
      stage.classList.add('has-mail', 'cuts'); uiPick.classList.add('sel'); uiSw.classList.add('sel'); stage.style.setProperty('--hue', '200deg');
      phone.classList.add('on'); toast.classList.add('on'); toast2.classList.add('on'); setStep(4); cur.style.display = 'none';
    } else {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && !running) play(); if (!visible) stop(); }, { threshold: 0.2 }).observe(stage);
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible && !running) play(); });
    }
  }

  // ---------- SLICE: strips separate with scroll ----------
  const sliceTrack = document.getElementById('slice');
  const sliceEmail = document.getElementById('sliceEmail');
  const scan = document.getElementById('scan');
  const slicePhone = document.getElementById('slicePhone');
  const sliceBadge = document.getElementById('sliceBadge');
  if (sliceTrack && sliceEmail) {
    const IMG = 'landing/thumbs/generic-news.jpg?v=202610160757';
    const STRIPS = [0.085, 0.2, 0.14, 0.17, 0.17, 0.12, 0.115]; // row heights as fractions of the image (nav, hero, copy, products, quote, cta, footer)
    const labels = ['nav', 'hero · link', 'copy', 'r3c1 · link', 'quote', 'cta · link', 'footer'];
    let acc = 0;
    const strips = STRIPS.map((h, i) => {
      const el = document.createElement('div');
      el.className = 'strip';
      el.style.backgroundImage = `url(${IMG})`;
      el.style.top = `${acc * 100}%`; el.style.height = `${h * 100}%`;
      el.dataset.off = String(acc); el.dataset.h = String(h);
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = labels[i]; el.appendChild(tag);
      sliceEmail.appendChild(el); acc += h; return el;
    });
    const sizeStrips = () => { const H = sliceEmail.clientHeight; strips.forEach((el) => { el.style.backgroundSize = `100% ${H}px`; el.style.backgroundPosition = `0 ${-Number(el.dataset.off) * H}px`; }); };
    sizeStrips(); addEventListener('resize', sizeStrips);
    const stageEl = document.getElementById('sliceStage'), copyEl = document.querySelector('.slice-copy');
    const stacked = window.matchMedia('(max-width: 1024px)');
    const update = () => {
      let q;
      if (stacked.matches && stageEl) { const r = stageEl.getBoundingClientRect(); q = clamp((innerHeight * 0.92 - r.top) / (innerHeight * 0.75), 0, 1); }
      else q = progressOf(sliceTrack);
      const enter = clamp(q / 0.16, 0, 1), ee = 1 - Math.pow(1 - enter, 3);   // email rises from the floor, copy slides in
      if (stageEl) { stageEl.style.transform = `rotateX(${(1 - ee) * 42}deg) translateY(${(1 - ee) * 140}px) scale(${0.84 + ee * 0.16})`; stageEl.style.opacity = String(0.1 + ee * 0.9); }
      if (copyEl) { copyEl.style.transform = `translateX(${(1 - ee) * -60}px)`; copyEl.style.opacity = String(ee); }
      const cutAt = clamp((q - 0.16) / 0.38, 0, 1);      // then the scan line sweeps
      const spread = clamp((q - 0.5) / 0.3, 0, 1);       // then strips separate
      const phone = q > 0.78;
      if (scan) { scan.style.opacity = cutAt > 0 && cutAt < 1 ? '1' : '0'; scan.style.top = `${4 + cutAt * 92}%`; }
      strips.forEach((el, i) => {
        const off = Number(el.dataset.off);
        const cut = cutAt >= off;
        el.classList.toggle('cut', cut && q > 0.05);
        const dir = i % 2 ? 1 : -1;
        const z = spread * (40 + (i % 3) * 30) * dir, x = spread * (i - 3) * 9, ry = spread * dir * 9;
        el.style.transform = `translate3d(${x}px, ${spread * (i - 3) * 7}px, ${z}px) rotateY(${ry}deg)`;
      });
      if (slicePhone) slicePhone.classList.toggle('on', phone);
      if (sliceBadge) sliceBadge.classList.toggle('on', q > 0.58);
    };
    if (reduce) { strips.forEach((el) => el.classList.add('cut')); if (slicePhone) slicePhone.classList.add('on'); if (sliceBadge) sliceBadge.classList.add('on'); }
    else { update(); addEventListener('scroll', update, { passive: true }); }
  }

  // ---------- PALETTE DEMO: one render, hue follows the chosen palette ----------
  const palSw = document.getElementById('palSw'), palImg = document.getElementById('palImg'), palName = document.getElementById('palName');
  if (palSw && palImg) {
    const btns = Array.from(palSw.querySelectorAll('button'));
    let auto = null, idx = 0;
    const pick = (b) => { btns.forEach((x) => x.classList.toggle('on', x === b)); palImg.style.filter = `hue-rotate(${b.dataset.h}deg)`; palName.textContent = b.dataset.n; };
    palSw.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; clearInterval(auto); auto = null; idx = btns.indexOf(b); pick(b); });
    if (!reduce) new IntersectionObserver((es) => { if (es[0].isIntersecting && auto === null) auto = setInterval(() => { idx = (idx + 1) % btns.length; pick(btns[idx]); }, 2200); else if (!es[0].isIntersecting && auto) { clearInterval(auto); auto = null; } }, { threshold: 0.4 }).observe(palSw);
  }

  // ---------- ACCOUNT: sign up / sign in straight into Studio ----------
  const form = document.getElementById('signupForm');
  const A = window.PhloemAuth;
  // Whatever happens to auth.js, the form never does a native GET with the password in the URL.
  if (form && !A) form.addEventListener('submit', (e) => { e.preventDefault(); const err = document.getElementById('suErr'); if (err) { err.textContent = 'Không tải được module tài khoản. Tải lại trang hoặc mở Studio để đăng nhập.'; err.hidden = false; } });
  if (form && A) {
    const $ = (id) => document.getElementById(id);
    const t = (k) => { const d = (window.PHLOEM_I18N && window.PHLOEM_I18N[document.documentElement.lang]) || {}; return d[k] || k; };
    const navLogin = $('navLogin'), navUser = $('navUser'), err = $('suErr'), btn = $('suBtn'), btnText = $('suBtnText'), modeEl = $('suMode');
    let tab = 'register', busy = false;
    const paint = () => {
      const s = A.getSession();
      btnText.textContent = busy ? t('su_busy') : t(tab === 'login' ? 'su_submit_login' : 'su_submit_reg');
      btn.disabled = busy;
      $('suSigned').hidden = !s; form.querySelector('.su-fields').hidden = !!s; form.querySelector('.su-tabs').hidden = !!s;
      navLogin.hidden = !!s; navUser.hidden = !s;
      if (s) { const ini = (s.user.name || '?').trim().slice(0, 1).toUpperCase(); $('suName').textContent = s.user.name; $('suEmail').textContent = s.user.email; $('suAvatar').textContent = ini; navUser.querySelector('.av').textContent = ini; navUser.querySelector('span').textContent = s.user.name; }
    };
    const setTab = (next) => { tab = next; form.classList.toggle('login', tab === 'login'); form.querySelectorAll('.su-tabs button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); form.elements.password.autocomplete = tab === 'login' ? 'current-password' : 'new-password'; err.hidden = true; paint(); };
    window.__phloemAuthUi = paint;
    A.onAuthChange(paint);
    paint();
    A.detectMode().then((m) => { const k = m === 'relay' ? 'su_mode_relay' : 'su_mode_local'; modeEl.setAttribute('data-i', k); modeEl.textContent = t(k); });
    A.restore().then(paint).catch(() => {});
    form.querySelectorAll('.su-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    navLogin.addEventListener('click', () => { setTab('login'); setTimeout(() => form.elements.email.focus(), 450); });
    $('suLogout').addEventListener('click', () => { A.logout(); paint(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return;
      const f = form.elements, input = { name: f.name.value, email: f.email.value, password: f.password.value, brand: f.brand.value };
      busy = true; err.hidden = true; paint();
      try {
        await (tab === 'login' ? A.login(input) : A.register(input));
        location.href = 'studio/';
      } catch (ex) {
        const code = ex && ex.code ? ex.code : 'server';
        err.textContent = t('err_' + code); err.hidden = false;
        const field = f[code === 'exists' || code === 'notfound' ? 'email' : code === 'badpass' ? 'password' : code];
        if (field && field.focus) field.focus();
      } finally { busy = false; paint(); }
    });
  }

  // ---------- blobs parallax ----------
  if (!reduce) {
    const blobs = document.querySelectorAll('.blob');
    addEventListener('scroll', () => { const y = window.scrollY; blobs.forEach((b, i) => { b.style.transform = `translateY(${y * (0.06 + i * 0.04)}px)`; }); }, { passive: true });
  }
})();
