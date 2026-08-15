(() => {
	if (document.__moxi_mo)
		return;
	
	let liveFunctions = new Set();
	let pending = false;
	
	function recompute() {
		if (pending)
			return;
		pending = true;
		queueMicrotask(() => {
			liveFunctions.forEach( f => f() );
			setTimeout(() => pending = false);
		});
	}
	
	document.__moxi_mo = new MutationObserver(recs => {
		recs.forEach(r => {
			if (r.type === "childList")
				r.addedNodes.forEach(n => process(n));
		});
		recompute();
	});

	let AF = async function(){}.constructor;
	let HARGS = ["q", "wait", "trigger", "debounce"];
	
	/**
	 * @param {HTMLElement} elt
	 * @param {string} type
	 * @param {CustomEventInit} detail
	 * @param {boolean?} bubbles
	 */
	function fire(elt, type, detail, bubbles) {
		return elt.dispatchEvent(new CustomEvent(type, {
			detail,
			bubbles: bubbles ?? true,
			cancelable: true,
			composed: true,
		}));
	}
	
	/**
	 * @param {Node} elt
	 * @param {string} name
	 * @param {EventListenerOrEventListenerObject|null} handler
	 * @param {(AddEventListenerOptions|boolean)?} options
	 * @return {*}
	 */
	function el(elt, name, handler, options) {
		return elt.addEventListener(name, handler, options)
	}

	let _sym = Symbol();

	/**
	 * @return {function(number): Promise<unknown>}
	 */
	function mkSym() {
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
	}

	/**
	 * @param {HTMLElement} ctx
	 * @return {function(number|string): Promise<unknown>}
	 */
	function mkWait(ctx) {
		return x => new Promise(
			res => typeof x === "number"
				? setTimeout(res, x)
				: el(ctx, x, res, {once: true})
		);
	}

	/**
	 * @param {HTMLElement} elt
	 * @return {Element|null}
	 */
	function ignore(elt) {
		return elt.closest("[mx-ignore]");
	}

	/**
	 * @param {any} x
	 * @return {[x]|[]}
	 */
	function one(x) {
		return x ? [x] : [];
	}
	
	let POS = {
		before: "beforebegin",
		after: "afterend",
		start: "afterbegin",
		end: "beforeend",
	};
	
	/**
	 * @param {HTMLElement[]} elts
	 * @return {{}}
	 */
	function proxy(elts) {
		return new Proxy({}, {
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
	}

	/**
	 * @param {HTMLElement?} ctx
	 * @return {(function(string|HTMLElement): (HTMLElement[]))}
	 */
	function mkQuery(ctx) {
		return sel => {
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
							elts = one(all.find(e => ctx.compareDocumentPosition(e) & 4));
							break;
						default:
							elts = one(all.reverse().find(e => ctx.compareDocumentPosition(e) & 2));
							break;
					}
				}
			} else {
				elts = [ ...root.querySelectorAll(sel) ];
			}

			return proxy(elts);
		};
	}

	/**
	 * @param {HTMLElement & { __moxi:{} }} elt
	 */
	function init(elt) {
		if (elt.__moxi || ignore(elt))
			return;
		if (!fire(elt, "mx:init", {}))
			return;
		elt.__moxi = {};
		let trigger = fire.bind(0, elt);
		let liveRuns = [];
		for (let a of elt.attributes) {
			if (a.name === "live") {
				let fn = new AF(...HARGS, a.value);
				let debounce = mkSym();
				let run = () => elt.isConnected
					? fn.call(elt, mkQuery(elt), mkWait(elt), trigger, debounce)
					: liveFunctions.delete(run);
				liveFunctions.add(run);
				liveRuns.push(run);
			} else if (a.name.startsWith("on-")) {
				// TODO multi events with on-ev1.mod+ev2.mod
				let [ name, ...mods ] = a.name.slice(3).split(".");
				
				/**
				 * @param {("prevent"|"stop"|"halt"|"once"|"self"|"capture"|"passive"|"outside"|"anywhere"|"cc")} modifier
				 * @return {boolean}
				 */
				function has(modifier) {
					return mods.includes(modifier);
				}

				let debounce = mkSym();
				
				if (has("cc"))
					name = name.replace( /-([a-z])/g, (_, c) => c.toUpperCase() );
				let target = has("outside") || has("anywhere") ? document : elt;
				let opts = {
					capture: has("capture"),
					passive: has("passive")
				};
				let fn = new AF("event", ...HARGS, `with(event?.detail||{}){${a.value}}`);

				/**
				 * @param {Event?} ev
				 * @return {Promise<any>|void}
				 */
				function handler(ev) {
					if (ev && (has("self") && ev.target !== elt || has("outside") && elt.contains(ev.target)))
						return;
					if (has("halt") || has("prevent"))
						ev?.preventDefault();
					if (has("halt") || has("stop"))
						ev?.stopPropagation();
					if (has("once"))
						target.removeEventListener(name, handler, opts);
					return fn.call(elt, ev, mkQuery(elt), mkWait(elt), trigger, debounce).catch(e => {
						if (e !== _sym) {
							console.error(elt); // nhnd
							throw e;
						}
					});
				}
				elt.__moxi[name] = handler;
				
				if (name === "init")
					handler();
				else
					el(target, name, handler, opts);
			}
		}
		liveRuns.forEach(r => r());
		fire(elt, "mx:inited", {}, false);
	}

	/**
	 * @param {HTMLElement} n
	 */
	function process(n) {
		if (n.nodeType !== 1 || ignore(n))
			return;
		let r = document.evaluate("descendant-or-self::*[@live or @*[starts-with(name(),'on-')]]", n, null, 7, null);
		for (let i = 0; i < r.snapshotLength; i++)
			init(r.snapshotItem(i));
	}
	globalThis.q = mkQuery(document.documentElement);
	globalThis.wait = mkWait(document.documentElement);
	globalThis.transition = fn => document.startViewTransition
		? document.startViewTransition(fn)
		: fn();

	el(document, "mx:process", ev => process(ev.target));
	el(document, "refresh", recompute);
	el(document, "DOMContentLoaded", () => {
		document.__moxi_mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
		el(document, "input", recompute, true);
		el(document, "change", recompute, true);
		process(document.body);
	});
})();
