/** Erro de aplicação com mensagem pronta para o usuário. */
export class AppError extends Error {
  constructor(message, { network = false, code = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.network = network; // falha de conexão (pode tentar de novo)
    this.code = code;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
