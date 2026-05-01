import axios from 'axios';
import { supabase } from './supabase';

const API_URL = "http://localhost:4000/api";

const api = axios.create({
    baseURL: API_URL,
});

api.interceptors.request.use(async (config) => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || '71e1f783-95a2-463b-ac32-26e07c0a82ca';
    config.headers['x-user-id'] = userId;
    return config;
});

export default api;
