import { createServerlessAdapter } from './_serverlessAdapter.js';
import core from './_core/bank.cjs';

export const config = {
  maxDuration: 30,
};

export default createServerlessAdapter(core.handler);
