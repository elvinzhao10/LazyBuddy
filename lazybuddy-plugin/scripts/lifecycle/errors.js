'use strict';

class LifecycleError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LifecycleError';
    this.code = code;
  }
}

module.exports = { LifecycleError };
