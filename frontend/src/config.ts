export interface RuntimeConfig {
  amapKey: string;
  amapSecurityCode: string;
  editRequired: boolean;
  siteTitle: string;
  siteSocialDescription: string;
  homeBaseCity: string;
  ownerProfileLines: string[];
  ownerGithub: string;
  ownerEmail: string;
  ownerWechat: string;
  ownerPlatforms: string;
  titleImageUrl: string;
  exportTitleImageUrl: string;
  overviewQrUrl: string;
  socialPreviewUrl: string;
}

const FALLBACK: RuntimeConfig = {
  amapKey: '',
  amapSecurityCode: '',
  editRequired: false,
  siteTitle: '',
  siteSocialDescription: '',
  homeBaseCity: '',
  ownerProfileLines: [],
  ownerGithub: '',
  ownerEmail: '',
  ownerWechat: '',
  ownerPlatforms: '',
  titleImageUrl: '',
  exportTitleImageUrl: '',
  overviewQrUrl: '',
  socialPreviewUrl: '',
};

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

function normalize(data: Partial<RuntimeConfig> | null): RuntimeConfig {
  if (!data) {
    return {
      ...FALLBACK,
      amapKey: import.meta.env.VITE_AMAP_KEY || '',
      amapSecurityCode: import.meta.env.VITE_AMAP_SECURITY_CODE || '',
    };
  }
  return {
    amapKey: data.amapKey || import.meta.env.VITE_AMAP_KEY || '',
    amapSecurityCode: data.amapSecurityCode || import.meta.env.VITE_AMAP_SECURITY_CODE || '',
    editRequired: Boolean(data.editRequired),
    siteTitle: data.siteTitle || '',
    siteSocialDescription: data.siteSocialDescription || '',
    homeBaseCity: data.homeBaseCity || '',
    ownerProfileLines: Array.isArray(data.ownerProfileLines) ? data.ownerProfileLines : [],
    ownerGithub: data.ownerGithub || '',
    ownerEmail: data.ownerEmail || '',
    ownerWechat: data.ownerWechat || '',
    ownerPlatforms: data.ownerPlatforms || '',
    titleImageUrl: data.titleImageUrl || '',
    exportTitleImageUrl: data.exportTitleImageUrl || '',
    overviewQrUrl: data.overviewQrUrl || '',
    socialPreviewUrl: data.socialPreviewUrl || '',
  };
}

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfigPromise) return runtimeConfigPromise;

  runtimeConfigPromise = fetch('/api/config')
    .then(res => res.ok ? res.json() : null)
    .then(normalize)
    .catch(() => normalize(null));

  return runtimeConfigPromise;
}

import { useEffect, useState } from 'react';

export function useRuntimeConfig(): RuntimeConfig | null {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    getRuntimeConfig().then(c => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, []);
  return config;
}
