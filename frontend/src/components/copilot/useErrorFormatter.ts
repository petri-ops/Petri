/**
 * Hook for formatting errors with user-friendly messages.
 * Provides error classification, severity levels, and detail visibility control.
 */

import { useCallback } from 'react';
import {
  type ErrorSeverity,
  type ErrorMessageConfig,
  classifyError,
  formatErrorForUser,
  ERROR_MESSAGES,
} from './errorMessages';

export interface FormattedError {
  code: string;
  userMessage: string;
  severity: ErrorSeverity;
  showDetails: boolean;
  technicalDetails?: string;
}

/**
 * Hook for formatting errors with user-friendly messages.
 */
export function useErrorFormatter() {
  /**
   * Format an error for user display.
   * Returns structured error information for UI rendering.
   */
  const formatError = useCallback((error: Error | string): FormattedError => {
    return formatErrorForUser(error);
  }, []);

  /**
   * Get error message config by code.
   */
  const getErrorConfig = useCallback((code: string): ErrorMessageConfig | undefined => {
    return ERROR_MESSAGES[code];
  }, []);

  /**
   * Check if an error should show technical details.
   */
  const shouldShowDetails = useCallback((error: Error | string): boolean => {
    const { mapped } = classifyError(error);
    return mapped.showDetails;
  }, []);

  /**
   * Get severity level from error.
   */
  const getSeverity = useCallback((error: Error | string): ErrorSeverity => {
    const { mapped } = classifyError(error);
    return mapped.severity;
  }, []);

  /**
   * Get user-friendly message from error.
   */
  const getUserMessage = useCallback((error: Error | string): string => {
    const { mapped } = classifyError(error);
    return mapped.userMessage;
  }, []);

  /**
   * Get error code from error.
   */
  const getErrorCode = useCallback((error: Error | string): string => {
    const { code } = classifyError(error);
    return code;
  }, []);

  /**
   * Extract technical details from error (stack trace, etc).
   */
  const getTechnicalDetails = useCallback((error: Error | string): string | undefined => {
    if (error instanceof Error) {
      return error.stack || error.message;
    }
    return undefined;
  }, []);

  return {
    formatError,
    getErrorConfig,
    shouldShowDetails,
    getSeverity,
    getUserMessage,
    getErrorCode,
    getTechnicalDetails,
  };
}


