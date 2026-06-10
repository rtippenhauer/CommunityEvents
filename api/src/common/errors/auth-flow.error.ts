export class AuthFlowError extends Error {
  constructor(
    public readonly reason: string,
    public readonly boundEmail?: string,
  ) {
    super(reason);
    this.name = 'AuthFlowError';
  }
}
