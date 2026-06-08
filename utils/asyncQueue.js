class AsyncQueue {
  constructor() {
    this._items = [];
    this._waiters = [];
  }

  enqueue(item) {
    this._items.push(item);
    const waiter = this._waiters.shift();
    if (waiter) waiter();
  }

  shift() {
    return this._items.shift();
  }

  waitForItem() {
    if (this._items.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._waiters.push(resolve);
    });
  }

  get length() {
    return this._items.length;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { AsyncQueue, sleep };

