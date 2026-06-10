export class AuthFlowError extends Error {
  constructor(
    public readonly reason: string,
    public readonly boundEmail?: string,
  ) {
    super(reason);
    this.name = 'AuthFlowError';
    // Restore prototype chain broken by TypeScript when extending built-in Error
    Object.setPrototypeOf(this, AuthFlowError.prototype);
  }
}
