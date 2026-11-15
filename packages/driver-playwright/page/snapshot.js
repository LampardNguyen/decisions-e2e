// Chạy trong từng frame (inject bằng frame.evaluate). Cài window.__de2e một lần cho mỗi document.
// Không import gì, không phụ thuộc bundler: file này được đọc dạng text và gửi nguyên văn vào trang.
(() => {
  if (window.__de2e) return;

  const ids = new WeakMap(); // Node -> id
  const nodes = new Map(); // id -> WeakRef<Node>
  const secrets = new WeakSet(); // ô đã điền từ {{SECRET}}
  let nextId = 1;

  // <a> không có href vẫn tính: SPA thường gắn listener bằng JS (vd. <a id="content"> ở menu). Neo rỗng tự bị loại vì không có kích thước.
  const INTERACTIVE =
    'a,button,input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick],' +
    "[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option]," +
    "[role=combobox],[role=textbox],[role=searchbox]";
  const TEXT_TYPES = new Set(["text", "email", "password", "tel", "number", "search", "url", "date", "datetime-local", "month", "time", "week"]);
  const BUTTON_TYPES = new Set(["submit", "button", "reset", "image"]);
  const SKIP_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "TEMPLATE"]);

  const clean = (s, max) => {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };

  function idOf(el) {
    let id = ids.get(el);
    if (!id) {
      id = nextId++;
      ids.set(el, id);
      nodes.set(id, new WeakRef(el));
    }
    return id;
  }

  function get(id) {
    const el = nodes.get(id)?.deref();
    return el && el.isConnected ? el : null;
  }

  // Duyệt mọi element, kể cả trong shadow DOM mở.
  function* walk(root) {
    for (const el of root.querySelectorAll("*")) {
      yield el;
      if (el.shadowRoot) yield* walk(el.shadowRoot);
    }
  }

  /** Rect nếu element hiển thị và nằm trong viewport ±1 màn hình; ngược lại null. */
  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    const vw = innerWidth, vh = innerHeight;
    if (r.bottom < -vh || r.top > 2 * vh || r.right < -vw || r.left > 2 * vw) return null;
    return r;
  }

  const inViewport = (r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

  function isInteractive(el) {
    if (el.matches(INTERACTIVE)) return true;
    // <label> của một control đang hiển thị: control đó đã được liệt kê.
    if (el.tagName === "LABEL" && el.control && visibleRect(el.control)) return false;
    if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return true;
    // Framework (Vue/React) gắn listener không qua attribute: nhận diện bằng con trỏ pointer,
    // chỉ lấy element ngoài cùng (con thừa hưởng cursor từ cha).
    if (getComputedStyle(el).cursor !== "pointer") return false;
    const parent = el.parentElement;
    return !parent || getComputedStyle(parent).cursor !== "pointer";
  }

  function inputType(el) {
    return (el.getAttribute("type") || "text").toLowerCase();
  }

  function roleOf(el) {
    const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
    if (explicit) return explicit;
    switch (el.tagName) {
      case "A": return "link";
      case "BUTTON": return "button";
      case "SELECT": return "select";
      case "TEXTAREA": return "textbox";
      case "INPUT": {
        const t = inputType(el);
        if (t === "checkbox" || t === "radio") return t;
        if (BUTTON_TYPES.has(t)) return "button";
        if (t === "range") return "slider";
        if (t === "file") return "file";
        if (t === "search") return "searchbox";
        return el.hasAttribute("list") ? "combobox" : "textbox";
      }
    }
    return el.isContentEditable ? "textbox" : "clickable";
  }

  // Checkbox/radio KHÔNG phải editable.
  function isEditable(el) {
    if (el.readOnly) return false;
    if (el.tagName === "INPUT") return TEXT_TYPES.has(inputType(el));
    return el.tagName === "TEXTAREA" || el.isContentEditable;
  }

  function isDisabled(el) {
    return el.disabled === true || el.getAttribute("aria-disabled") === "true";
  }

  function opsOf(el, role) {
    if (isDisabled(el) || role === "file") return [];
    if (el.tagName === "SELECT") return ["SELECT"];
    if (isEditable(el)) {
      const opensPopup = role === "combobox" || el.hasAttribute("aria-haspopup");
      return opensPopup ? ["TYPE_TEXT", "PRESS_ENTER", "CLICK"] : ["TYPE_TEXT", "PRESS_ENTER"];
    }
    return ["CLICK"];
  }

  function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria, 120);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\s+/).map((id) => el.getRootNode().getElementById?.(id)?.innerText || "").join(" ");
      if (text.trim()) return clean(text, 120);
    }
    if (el.labels?.length) return clean(el.labels[0].innerText, 120);
    for (const attr of ["placeholder", "title", "alt"]) {
      const v = el.getAttribute(attr);
      if (v) return clean(v, 120);
    }
    if (el.tagName === "INPUT" && BUTTON_TYPES.has(inputType(el)) && el.value) return clean(el.value, 120);
    if (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") return clean(el.getAttribute("name"), 120);
    return clean(el.innerText || el.textContent, 120) || clean(el.querySelector("img[alt]")?.alt, 120);
  }

  /**
   * Gợi ý cho element không có text (nút chỉ có icon): tên icon, id hoặc class.
   * Trả về trong ngoặc đơn để model biết đây không phải text trên trang.
   */
  function hintOf(el) {
    const svgTitle = el.querySelector("svg title")?.textContent;
    const use = el.querySelector("use");
    const icon = use?.getAttribute("href") || use?.getAttribute("xlink:href");
    const img = el.tagName === "IMG" ? el : el.querySelector("img[src]");
    const file = img?.getAttribute("src")?.split(/[?#]/)[0].split("/").pop()?.replace(/\.[a-z0-9]+$/i, "");
    // Class của chính element và của icon con đầu tiên (vd. <i class="fa fa-bars">).
    const inner = el.querySelector("i[class],span[class],svg[class]");
    const names = [el.id, el.getAttribute("class"), inner?.getAttribute("class"), el.getAttribute("data-testid")].filter(Boolean).join(" ");
    const hint = clean(svgTitle || (icon && icon.split("#").pop()) || file || names, 60);
    return hint ? "(" + hint + ")" : "";
  }

  function valueOf(el) {
    if (el.tagName === "SELECT") return clean(el.selectedOptions[0]?.label, 80);
    const typed = (el.tagName === "INPUT" && TEXT_TYPES.has(inputType(el))) || el.tagName === "TEXTAREA";
    if (typed) {
      // Không bao giờ gửi giá trị ô password hoặc ô đã điền secret.
      if (inputType(el) === "password" || secrets.has(el)) return el.value ? "<filled>" : "<empty>";
      return clean(el.value, 80);
    }
    if (el.isContentEditable) return secrets.has(el) ? "<filled>" : clean(el.innerText, 80);
    return undefined;
  }

  const ariaBool = (el, name) => {
    const v = el.getAttribute(name);
    return v === "true" ? true : v === "false" ? false : undefined;
  };

  /** Text ngắn quanh element (dòng bảng, nhóm form) để phân biệt các element trùng nhãn. */
  function nearTextOf(el, label) {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 4; depth++, node = node.parentElement) {
      const text = clean(node.innerText, 200);
      if (text.length >= 200) return undefined; // khối quá lớn, không còn là "xung quanh"
      if (text && text !== label && text.length > label.length) return clean(text, 80);
    }
    return undefined;
  }

  function visibleText(max) {
    const out = [];
    let size = 0;
    const range = document.createRange();
    const collect = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && size < max; node = walker.nextNode()) {
        const text = node.nodeValue.replace(/\s+/g, " ").trim();
        const parent = node.parentElement;
        if (!text || !parent || SKIP_TEXT.has(parent.tagName)) continue;
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || !inViewport(r)) continue;
        if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        out.push(text);
        size += text.length + 1;
      }
    };
    if (document.body) collect(document.body);
    return out.join("\n").slice(0, max);
  }

  function snapshot() {
    const found = [];
    for (const el of walk(document)) {
      if (!isInteractive(el)) continue;
      const rect = visibleRect(el);
      if (!rect) continue;
      const role = roleOf(el);
      const text = labelOf(el);
      const item = { el, id: idOf(el), role, label: text || hintOf(el), unlabeled: !text, ops: opsOf(el, role), inViewport: inViewport(rect) };
      const value = valueOf(el);
      if (value !== undefined) item.value = value;
      if (role === "checkbox" || role === "radio" || role === "switch") item.checked = el.checked ?? ariaBool(el, "aria-checked") ?? false;
      const selected = ariaBool(el, "aria-selected");
      if (selected !== undefined) item.selected = selected;
      const expanded = ariaBool(el, "aria-expanded");
      if (expanded !== undefined) item.expanded = expanded;
      if (isDisabled(el)) item.disabled = true;
      if (el.tagName === "SELECT") {
        item.options = [...el.options].slice(0, 255).map((o, i) => ({ index: String(i), label: clean(o.label, 80), value: o.value }));
      }
      found.push(item);
    }
    // Vỏ bọc (vd. <li role=menuitem>) chỉ chứa đúng một element tương tác cùng nhãn: bỏ vỏ, giữ element bên trong.
    // Bấm vào tâm vỏ có thể trượt khỏi <a> mang handler (dropdown 複製 của trang admin thật).
    const NATIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
    const wrappers = new Set();
    for (const f of found) {
      if (NATIVE.has(f.el.tagName)) continue;
      const inner = found.filter((g) => g !== f && composedContains(f.el, g.el));
      if (inner.length === 1 && inner[0].label === f.label) wrappers.add(f);
    }
    if (wrappers.size) found.splice(0, found.length, ...found.filter((f) => !wrappers.has(f)));
    // nearText chỉ cho element không có nhãn hoặc trùng role+nhãn với element khác.
    const counts = new Map();
    for (const f of found) counts.set(f.role + "|" + f.label, (counts.get(f.role + "|" + f.label) || 0) + 1);
    for (const f of found) {
      if (f.unlabeled || counts.get(f.role + "|" + f.label) > 1) {
        const near = nearTextOf(f.el, f.unlabeled ? "" : f.label);
        if (near) f.nearText = near;
      }
      delete f.el;
      delete f.unlabeled;
    }
    return { elements: found, text: visibleText(6000) };
  }

  // a chứa b, tính cả qua ranh giới shadow DOM.
  function composedContains(a, b) {
    for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true;
    return false;
  }

  /** true nếu tâm của element bị phần tử khác che (sau khi cuộn vào view). */
  function occluded(id) {
    const el = get(id);
    if (!el) return true;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (!hit) return true;
    return !(composedContains(el, hit) || (hit.closest("label")?.control === el));
  }

  function markSecret(id) {
    const el = get(id);
    if (el) secrets.add(el);
  }

  /** Mô tả ngắn một node cho việc gỡ lỗi: tag, id, class và các dấu hiệu "bấm được". */
  function describeNode(n) {
    const signs = ["cursor=" + getComputedStyle(n).cursor];
    for (const a of ["role", "tabindex", "href", "onclick", "aria-expanded", "aria-haspopup"]) {
      if (n.hasAttribute(a)) signs.push(a === "href" || a === "onclick" ? a : a + "=" + n.getAttribute(a));
    }
    if (n._vei) signs.push("vue-on:" + Object.keys(n._vei).join(","));
    const reactKey = Object.keys(n).find((k) => k.startsWith("__reactProps$"));
    if (reactKey) signs.push("react-on:" + Object.keys(n[reactKey]).filter((k) => /^on[A-Z]/.test(k)).join(","));
    const cls = (n.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (cls ? "." + cls : "") + " [" + signs.join(" ") + "]";
  }

  /**
   * Gỡ lỗi: các đoạn text ngắn đang hiển thị nhưng KHÔNG thuộc element nào trong bảng
   * (ứng viên bị bỏ sót, vd. mục menu là <div> không có dấu hiệu bấm được), kèm chuỗi cha.
   */
  function unlisted(max) {
    const listed = [];
    for (const el of walk(document)) if (isInteractive(el) && visibleRect(el)) listed.push(el);
    const out = [];
    for (const el of walk(document)) {
      if (out.length >= max) break;
      if (SKIP_TEXT.has(el.tagName)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(" ").replace(/\s+/g, " ").trim();
      if (!own || own.length > 40) continue;
      const r = visibleRect(el);
      if (!r || !inViewport(r)) continue;
      if (listed.some((l) => composedContains(l, el))) continue;
      const chain = [];
      for (let n = el, depth = 0; n && n.nodeType === 1 && depth < 4; n = n.parentElement, depth++) chain.push(describeNode(n));
      out.push({ text: own, chain });
    }
    return out;
  }

  window.__de2e = { snapshot, get, occluded, markSecret, unlisted };
})();
