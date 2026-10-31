import { createContext, useContext } from 'react';

export const ExportQrContext = createContext(false);
export const useExportQr = () => useContext(ExportQrContext);
