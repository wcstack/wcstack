import { Window } from 'happy-dom';

const GLOBALS_KEYS = [
    'document', 'customElements', 'HTMLElement',
    'DocumentFragment', 'Node', 'NodeFilter', 'Comment', 'Text',
    'MutationObserver', 'ShadowRoot', 'Element', 'HTMLTemplateElement',
];
function installGlobals(window) {
    const saved = {};
    for (const key of GLOBALS_KEYS) {
        saved[key] = globalThis[key];
        globalThis[key] = window[key];
    }
    // URL.createObjectURL を無効化して、
    // loadFromInnerScript が base64 data: URL フォールバックを使うようにする
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = undefined;
    return () => {
        URL.createObjectURL = origCreateObjectURL;
        for (const key of GLOBALS_KEYS) {
            globalThis[key] = saved[key];
        }
    };
}
function installBaseUrl(baseUrl) {
    const OrigURL = globalThis.URL;
    const base = baseUrl;
    globalThis.URL = class extends OrigURL {
        constructor(input, inputBase) {
            if (typeof input === 'string' && input.startsWith('/') && inputBase === undefined) {
                super(input, base);
            }
            else {
                super(input, inputBase);
            }
        }
    };
    // 静的メソッドを引き継ぐ
    globalThis.URL.createObjectURL = OrigURL.createObjectURL;
    globalThis.URL.revokeObjectURL = OrigURL.revokeObjectURL;
    return () => { globalThis.URL = OrigURL; };
}
function extractStateData(stateEl) {
    const raw = stateEl.__state;
    if (!raw || typeof raw !== 'object')
        return {};
    const data = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('$') && typeof value !== 'function') {
            data[key] = value;
        }
    }
    return data;
}
async function renderToString(html, options) {
    const window = new Window();
    const restoreGlobals = installGlobals(window);
    const document = window.document;
    // 相対 URL を baseUrl で解決する URL コンストラクタパッチをインストール
    const restoreBaseUrl = options?.baseUrl
        ? installBaseUrl(options.baseUrl)
        : null;
    const { bootstrapState, getAllFragmentUUIDs, getFragmentInfoByUUID, getAllSsrPropertyNodes, getSsrProperties, clearSsrPropertyStore, getBindingsReady, VERSION, } = await import('@wcstack/state');
    bootstrapState({ ssr: true });
    clearSsrPropertyStore();
    try {
        // HTML をパース
        // connectedCallback が自動発火 → state ロード → $connectedCallback 実行
        document.body.innerHTML = html;
        // 全 <wcs-state> の $connectedCallback 完了を待機
        const stateElements = document.querySelectorAll('wcs-state');
        for (const stateEl of stateElements) {
            if ('connectedCallbackPromise' in stateEl) {
                await stateEl.connectedCallbackPromise;
            }
        }
        // buildBindings の完了を待機
        await getBindingsReady(document);
        // enable-ssr 属性を持つ <wcs-state> に <wcs-ssr> タグを生成
        for (const stateEl of stateElements) {
            if (!stateEl.hasAttribute('enable-ssr'))
                continue;
            const name = stateEl.getAttribute('name') || 'default';
            const stateData = extractStateData(stateEl);
            const ssrEl = document.createElement('wcs-ssr');
            ssrEl.setAttribute('name', name);
            ssrEl.setAttribute('version', VERSION);
            // 初期データ JSON
            const jsonScript = document.createElement('script');
            jsonScript.setAttribute('type', 'application/json');
            jsonScript.textContent = JSON.stringify(stateData);
            ssrEl.appendChild(jsonScript);
            // UUID で管理されているテンプレートを復元して格納
            const uuids = getAllFragmentUUIDs();
            for (const uuid of uuids) {
                const fragmentInfo = getFragmentInfoByUUID(uuid);
                if (!fragmentInfo)
                    continue;
                const tpl = document.createElement('template');
                tpl.setAttribute('id', uuid);
                const bindResult = fragmentInfo.parseBindTextResult;
                const bindText = bindResult.bindingType === 'else'
                    ? 'else:'
                    : `${bindResult.bindingType}: ${bindResult.statePathName}`;
                tpl.setAttribute('data-wcs', bindText);
                // fragment の中身をテンプレートにコピー
                const content = fragmentInfo.fragment.cloneNode(true);
                tpl.content.appendChild(content);
                ssrEl.appendChild(tpl);
            }
            // 属性で代替不可なプロパティをハイドレーション用に格納
            const ssrNodes = getAllSsrPropertyNodes();
            if (ssrNodes.length > 0) {
                const propsData = {};
                for (let i = 0; i < ssrNodes.length; i++) {
                    const node = ssrNodes[i];
                    const entries = getSsrProperties(node);
                    if (entries.length === 0)
                        continue;
                    const id = `wcs-ssr-${i}`;
                    node.setAttribute('data-wcs-ssr-id', id);
                    const props = {};
                    for (const entry of entries) {
                        props[entry.propName] = entry.value;
                    }
                    propsData[id] = props;
                }
                if (Object.keys(propsData).length > 0) {
                    const propsScript = document.createElement('script');
                    propsScript.setAttribute('type', 'application/json');
                    propsScript.setAttribute('data-wcs-ssr-props', '');
                    propsScript.textContent = JSON.stringify(propsData);
                    ssrEl.appendChild(propsScript);
                }
            }
            stateEl.parentNode?.insertBefore(ssrEl, stateEl);
        }
        return document.body.innerHTML;
    }
    finally {
        restoreBaseUrl?.();
        bootstrapState({ ssr: false });
        restoreGlobals();
        await window.close();
    }
}

var version = "0.1.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

class RenderCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "html", event: "wcs-render:html-changed" },
            { name: "loading", event: "wcs-render:loading-changed" },
            { name: "error", event: "wcs-render:error" },
        ],
    };
    _html = null;
    _loading = false;
    _error = null;
    get html() {
        return this._html;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    _setLoading(loading) {
        this._loading = loading;
        this.dispatchEvent(new CustomEvent("wcs-render:loading-changed", {
            detail: loading,
        }));
    }
    _setHtml(html) {
        this._html = html;
        this.dispatchEvent(new CustomEvent("wcs-render:html-changed", {
            detail: html,
        }));
    }
    _setError(error) {
        this._error = error;
        this.dispatchEvent(new CustomEvent("wcs-render:error", {
            detail: error,
        }));
    }
    async render(html) {
        this._setLoading(true);
        this._error = null;
        try {
            const result = await renderToString(html);
            this._setHtml(result);
            this._setLoading(false);
            return this._html;
        }
        catch (e) {
            this._setError(e instanceof Error ? e : new Error(String(e)));
            this._setLoading(false);
            return null;
        }
    }
}

export { GLOBALS_KEYS, RenderCore, VERSION, extractStateData, installBaseUrl, installGlobals, renderToString };
//# sourceMappingURL=index.esm.js.map
