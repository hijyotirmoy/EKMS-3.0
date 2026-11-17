import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.piramal.ekms',
  appName: 'EKMS 3.0',
  webDir: 'public',
  server: {
    url: 'https://ekms.in',
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
    LocalNotifications: {
      iconColor: '#2563EB',
    },
  },
};

export default config;
