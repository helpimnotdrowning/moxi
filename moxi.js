(() => {
	if (document.__moxi_mo)
		return;
	let liveFunctions = new Set();
	let pending = false;
	let recompute = () => {
		if (pending)
			return;
		pending = true;
		queueMicrotask(() => {
			liveFunctions.forEach( f => f() );
			setTimeout(() => pending = false);
		});
	};
	document.__moxi_mo = new MutationObserver(recs => {
		recs.forEach(r =>
			r.type === "childList" && r.addedNodes.forEach(n => process(n))
		);
		recompute();
	});
	let AF = async function(){}.constructor;
	let HARGS = ["q", "wait", "trigger", "debounce"];
	let fire = (elt, type, detail, bub) => elt.dispatchEvent(new CustomEvent(type, {
		detail,
		bubbles: bub ?? true,
		cancelable: true,
		composed: true,
	}));
	let el = (elt, name, handler, options) => elt.addEventListener(name, handler, options);
	let _sym = Symbol();
	let mkSym = () => {
		let last = 0;
		let j;
		return ms => new Promise((res, rej) => {
			j?.(_sym); // what?
			j = rej;
			let id = ++last;
			setTimeout(() => {
				if (id === last) {
					j = null;
					return res();
				}
				return false;
			}, ms);
		});
	};
	let mkWait = ctx =>
		x => new Promise(
			res => typeof x === "number"
				? setTimeout(res, x)
				: el(ctx, x, res, { once: true })
		);
	let ignore = elt => elt.closest("[mx-ignore]");
	let one = x => x ? [x] : [];
	let POS = {
		before: "beforebegin",
		after: "afterend",
		start: "afterbegin",
		end: "beforeend",
	};
	let proxy = elts => new Proxy({}, {
		get: (_, p) => {
			// don't turn this into a switch, the p==="arr" case causes #test58 to fail sometimes 
			if (p === "count")
				return elts.length;
			if (p === "arr")
				return () => elts.slice();
			if (p === Symbol.iterator)
				return () => elts.values();
			if (p === "trigger")
				return (t, d, b) => elts.forEach(e => fire(e, t, d, b));
			if (p === "insert")
				return (pos, s) => elts.forEach(e => e.insertAdjacentHTML(POS[pos], s));
			if (p === "take")
				return (cls, from) => {
					for (let e of typeof from === "string" ? document.querySelectorAll(from) : from)
						e.classList.remove(cls);
					for (let e of elts)
						e.classList.add(cls);
				};
			
			let v = elts[0]?.[p];
			if (v?.call)
				return (...a) => elts.map(e => e[p](...a))[0];
			if (v && typeof v === "object")
				return proxy(elts.map(e => e[p]));
			return v;
		},
		set: (_, p, v) => {
			elts.forEach(e => e[p] = v);
			recompute();
			return true;
		}
	});
	let mkQuery = ctx => sel => {
		if (typeof sel !== "string")
			return proxy(sel.nodeType
				? [ sel ]
				: [ ...sel ]
			);
		let im = sel.match(/^(.+)\s+in\s+(.+)$/);
		let root = document;
		if (im) {
			sel = im[1];
			root = im[2] === "this"
				? ctx
				: document.querySelector(im[2]);
		}
		if (!root)
			return proxy([]);
		let m = sel.match(/^(next|prev|closest|first|last)\s+(.+)$/), elts;
		if (m) {
			let [ , d, s ] = m;
			let cdp = e => ctx.compareDocumentPosition(e);
			if (d === "closest") {
				elts = one(ctx.closest(s));
			} else {
				let all = [ ...root.querySelectorAll(s) ];
				switch (d) {
					case "first":
						elts = all.slice(0, 1);
						break;
					case "last":
						elts = all.slice(-1);
						break;
					case "next":
						elts = one(all.find(e => cdp(e) & 4));
						break;
					default:
						elts = one(all.reverse().find(e => cdp(e) & 2));
						break;
				}
			}
		} else {
			elts = [ ...root.querySelectorAll(sel) ];
		}

		return proxy(elts);
	};
	let init = elt => {
		if (elt.__moxi || ignore(elt))
			return;
		if (!fire(elt, "mx:init", {}))
			return;
		elt.__moxi = {};
		let q = mkQuery(elt);
		let wait = mkWait(elt);
		let trigger = fire.bind(0, elt);
		let liveRuns = [];
		for (let a of elt.attributes) {
			if (a.name === "live") {
				let fn = new AF(...HARGS, a.value);
				let debounce = mkSym();
				let run = () => elt.isConnected
					? fn.call(elt, q, wait, trigger, debounce)
					: liveFunctions.delete(run);
				liveFunctions.add(run);
				liveRuns.push(run);
			} else if (a.name.startsWith("on-")) {
				let [ name, ...mods ] = a.name.slice(3).split(".");
				let has = m => mods.includes(m);
				let h = has("halt");
				let debounce = mkSym();
				if (has("cc"))
					name = name.replace( /-([a-z])/g, (_, c) => c.toUpperCase() );
				let target = has("outside") || has("anywhere") ? document : elt;
				let opts = {
					capture: has("capture"),
					passive: has("passive")
				};
				let fn = new AF("event", ...HARGS, `with(event?.detail||{}){${a.value}}`);
				let handler = elt.__moxi[name] = evt => {
					if (evt && (has("self") && evt.target !== elt || has("outside") && elt.contains(evt.target)))
						return;
					if (h || has("prevent"))
						evt?.preventDefault();
					if (h || has("stop"))
						evt?.stopPropagation();
					if (has("once"))
						target.removeEventListener(name, handler, opts);
					return fn.call(elt, evt, q, wait, trigger, debounce).catch(e => {
						if (e !== _sym) {
							console.error(elt); // nhnd
							throw e;
						}
					});
				};
				if (name === "init")
					handler();
				else
					el(target, name, handler, opts);
			}
		}
		liveRuns.forEach(r => r());
		fire(elt, "mx:inited", {}, false);
	};
	let process = n => {
		if (n.nodeType !== 1 || ignore(n))
			return;
		let r = document.evaluate("descendant-or-self::*[@live or @*[starts-with(name(),'on-')]]", n, null, 7, null);
		for (let i = 0; i < r.snapshotLength; i++)
			init(r.snapshotItem(i));
	};
	let gt = globalThis;
	let de = document.documentElement;
	gt.q = mkQuery(de);
	gt.wait = mkWait(de);
	gt.transition = fn => document.startViewTransition
		? document.startViewTransition(fn)
		: fn();

	el(document, "mx:process", evt => process(evt.target));
	el(document, "refresh", recompute);
	el(document, "DOMContentLoaded", () => {
		document.__moxi_mo.observe(de, { childList: true, subtree: true, attributes: true, characterData: true });
		el(document, "input", recompute, true);
		el(document, "change", recompute, true);
		process(document.body);
	});
})();
