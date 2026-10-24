#!/usr/bin/env node
import { main, handleError } from './cli/main';

main(process.argv.slice(2)).catch(handleError);
