import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { createHandler } from './handler.ts';

Deno.serve(createHandler(createClient, (key: string) => Deno.env.get(key)));
