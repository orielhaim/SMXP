class EventBus {
  constructor() {
    this.subscribers = new Map();
  }

  subscribe(address, callback) {
    if (!this.subscribers.has(address)) {
      this.subscribers.set(address, new Set());
    }
    this.subscribers.get(address).add(callback);
  }

  unsubscribe(address, callback) {
    if (this.subscribers.has(address)) {
      const subs = this.subscribers.get(address);
      subs.delete(callback);
      if (subs.size === 0) {
        this.subscribers.delete(address);
      }
    }
  }

  publish(address, event) {
    if (this.subscribers.has(address)) {
      for (const callback of this.subscribers.get(address)) {
        try {
          callback(event);
        } catch (e) {
          console.error(`Error in event callback for ${address}:`, e);
        }
      }
    }
  }
}

export const eventBus = new EventBus();
