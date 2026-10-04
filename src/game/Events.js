export class Events {
  constructor() { this.h = {}; }
  on(type, fn) { (this.h[type] ||= []).push(fn); return () => { this.h[type] = this.h[type].filter((f) => f !== fn); }; }
  emit(type, data) { for (const f of this.h[type] || []) f(data); }
}
