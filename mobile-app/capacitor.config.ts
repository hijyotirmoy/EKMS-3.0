import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.piramal.ekms.mobile',
  appName: 'EKMS Mobile',
  webDir: 'dist',
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
