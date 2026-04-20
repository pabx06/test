import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { logger } from "../config/logger";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: "not_found",
    message: `No route for ${request.method} ${request.originalUrl}`
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "validation_error",
      details: error.flatten()
    });
    return;
  }

  logger.error(
    {
      error,
      path: request.originalUrl,
      method: request.method
    },
    "unhandled request error"
  );

  response.status(500).json({
    error: "internal_server_error"
  });
};
