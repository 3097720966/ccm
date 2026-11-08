// SillyTavern 扩展：悬浮窗 + iOS 风格面板，查询 New API / One API 账户余额
const MODULE = 'balance_checker';
const ICON = 'https://iili.io/nbCfdxI.png';
const FAB = 52;
const DEFAULTS = {
    baseUrl: '',
    token: '',
    userId: '',
    unit: 500000,
    useProxy: false,
    autoRefresh: false,
    pos: null,
    last: null,
};

function S() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
    for (const k of Object.keys(DEFAULTS)) {
        if (extensionSettings[MODULE][k] === undefined) extensionSettings[MODULE][k] = DEFAULTS[k];
    }
    return extensionSettings[MODULE];
}
const save = () => SillyTavern.getContext().saveSettingsDebounced();
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

async function fetchBalance() {
    const s = S();
    // 清洗输入：去掉所有空白/换行/不可见字符，避免产生非法请求头
    const base = s.baseUrl.replace(/\s+/g, '').replace(/\/+$/, '');
    const token = s.token.replace(/^\s*Bearer\s+/i, '').replace(/[^\x21-\x7E]/g, '');
    const uid = String(s.userId).replace(/\D/g, '');
    if (!base || !token || !uid) {
        throw new Error('请先在下方填写站点地址、访问令牌和用户 ID');
    }
    if (!/^https?:\/\/[^/]+/i.test(base)) {
        throw new Error('站点地址需要以 https:// 开头');
    }
    const target = `${base}/api/user/self`;
    const url = s.useProxy ? `/proxy/${target}` : target;

    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'New-Api-User': uid,
                'Accept': 'application/json',
            },
        });
    } catch (e) {
        if (s.useProxy) throw new Error('请求失败：' + (e.message || e) + '（请确认酒馆已开启 enableCorsProxy）');
        throw new Error('请求失败，可能是跨域限制，可打开「使用酒馆代理」后重试');
    }
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    const body = await resp.json();
    if (body.success === false) throw new Error(body.message || '接口返回失败');

    const d = body.data || {};
    const unit = Number(s.unit) || 500000;
    return {
        username: d.username || '-',
        remain: (d.quota || 0) / unit,
        used: (d.used_quota || 0) / unit,
        requests: d.request_count ?? '-',
        time: Date.now(),
    };
}

function showInfo(info) {
    $('#bcx-remain').text(money(info.remain));
    $('#bcx-used').text(money(info.used));
    $('#bcx-req').text(Number(info.requests).toLocaleString('en-US'));
    $('#bcx-user').text(info.username);
    $('#bcx-status').removeClass('bcx-err').text('更新于 ' + hhmm(info.time));
}

async function refresh() {
    const btn = $('#bcx-refresh');
    btn.addClass('bcx-loading').text('查询中…');
    try {
        const info = await fetchBalance();
        S().last = info;
        save();
        showInfo(info);
    } catch (e) {
        $('#bcx-status').addClass('bcx-err').text(e.message);
    }
    btn.removeClass('bcx-loading').text('刷新余额');
}

function openPanel() {
    $('#bcx-overlay').addClass('bcx-show');
    $('body').addClass('bcx-lock');
    if (S().last) showInfo(S().last);
    refresh();
}
function closePanel() {
    $('#bcx-overlay').removeClass('bcx-show');
    $('body').removeClass('bcx-lock');
}

function clampPos(x, y) {
    return {
        x: Math.min(Math.max(4, x), window.innerWidth - FAB - 4),
        y: Math.min(Math.max(4, y), window.innerHeight - FAB - 4),
    };
}
function placeFab() {
    const s = S();
    const p = s.pos || { x: window.innerWidth - FAB - 12, y: Math.round(window.innerHeight * 0.6) };
    const c = clampPos(p.x, p.y);
    $('#bcx-fab').css({ left: c.x + 'px', top: c.y + 'px' });
}

function enableDrag(el) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false;
    el.on('pointerdown', (e) => {
        const ev = e.originalEvent;
        down = true; moved = false;
        sx = ev.clientX; sy = ev.clientY;
        const r = el[0].getBoundingClientRect();
        ox = r.left; oy = r.top;
        try { el[0].setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    });
    el.on('pointermove', (e) => {
        if (!down) return;
        const ev = e.originalEvent;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        const c = clampPos(ox + dx, oy + dy);
        el.css({ left: c.x + 'px', top: c.y + 'px' });
    });
    const end = () => {
        if (!down) return;
        down = false;
        if (moved) {
            const r = el[0].getBoundingClientRect();
            S().pos = { x: r.left, y: r.top };
            save();
        } else {
            openPanel();
        }
    };
    el.on('pointerup pointercancel', end);
}

function buildUI() {
    const s = S();

    const fab = $(`
        <div id="bcx-fab" title="账户余额">
            <img src="${ICON}" alt="" draggable="false" referrerpolicy="no-referrer">
            <span class="bcx-fab-fallback">💰</span>
        </div>`);
    fab.find('img').on('error', function () { $(this).hide(); fab.find('.bcx-fab-fallback').show(); });

    const overlay = $(`
        <div id="bcx-overlay">
            <div class="bcx-sheet">
                <div class="bcx-grab"></div>
                <div class="bcx-head">
                    <div class="bcx-title">账户余额</div>
                    <button type="button" class="bcx-done">完成</button>
                </div>

                <div class="bcx-hero">
                    <div class="bcx-hero-label">剩余额度</div>
                    <div class="bcx-hero-num" id="bcx-remain">--</div>
                    <div class="bcx-hero-sub" id="bcx-status">尚未查询</div>
                </div>

                <div class="bcx-group">
                    <div class="bcx-row"><span>历史消耗</span><span class="bcx-val" id="bcx-used">--</span></div>
                    <div class="bcx-row"><span>请求次数</span><span class="bcx-val" id="bcx-req">--</span></div>
                    <div class="bcx-row"><span>用户</span><span class="bcx-val" id="bcx-user">--</span></div>
                </div>

                <button type="button" class="bcx-btn" id="bcx-refresh">刷新余额</button>

                <div class="bcx-section">设置</div>
                <div class="bcx-group">
                    <label class="bcx-row"><span>站点地址</span>
                        <input class="bcx-input" id="bcx-base" type="url" placeholder="https://example.com" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
                    <label class="bcx-row"><span>访问令牌</span>
                        <input class="bcx-input" id="bcx-token" type="password" placeholder="必填" autocomplete="off"></label>
                    <label class="bcx-row"><span>用户 ID</span>
                        <input class="bcx-input" id="bcx-uid" type="text" inputmode="numeric" placeholder="数字"></label>
                    <label class="bcx-row"><span>额度换算</span>
                        <input class="bcx-input" id="bcx-unit" type="number" inputmode="numeric" placeholder="500000"></label>
                </div>
                <div class="bcx-group">
                    <div class="bcx-row"><span>使用酒馆代理</span>
                        <label class="bcx-switch"><input type="checkbox" id="bcx-proxy"><i></i></label></div>
                    <div class="bcx-row"><span>启动时自动查询</span>
                        <label class="bcx-switch"><input type="checkbox" id="bcx-auto"><i></i></label></div>
                </div>
                <div class="bcx-foot">额度换算：多少额度等于 $1，默认 500000。<br>令牌只保存在你自己的酒馆设置里。</div>
            </div>
        </div>`);

    $('body').append(fab, overlay);

    overlay.on('click', (e) => { if (e.target === overlay[0]) closePanel(); });
    overlay.find('.bcx-done').on('click', closePanel);
    $('#bcx-refresh').on('click', refresh);

    $('#bcx-base').val(s.baseUrl).on('input', function () { s.baseUrl = this.value; save(); });
    $('#bcx-token').val(s.token).on('input', function () { s.token = this.value; save(); });
    $('#bcx-uid').val(s.userId).on('input', function () { s.userId = this.value; save(); });
    $('#bcx-unit').val(s.unit).on('input', function () { s.unit = Number(this.value) || 500000; save(); });
    $('#bcx-proxy').prop('checked', s.useProxy).on('change', function () { s.useProxy = this.checked; save(); });
    $('#bcx-auto').prop('checked', s.autoRefresh).on('change', function () { s.autoRefresh = this.checked; save(); });

    placeFab();
    enableDrag(fab);
    $(window).on('resize', placeFab);

    // 魔法棒菜单里也放一个入口
    const item = $(`
        <div class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-wallet extensionsMenuExtensionButton"></div>查询余额
        </div>`);
    item.on('click', openPanel);
    $('#extensionsMenu').append(item);
}

jQuery(() => {
    buildUI();
    if (S().autoRefresh) {
        fetchBalance().then((info) => {
            S().last = info; save();
            toastr.info(`剩余额度 ${money(info.remain)}`, '账户余额');
        }).catch(() => { /* 静默 */ });
    }
});
