// src/openapi/types.ts
export type SchemaObject = {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  additionalProperties?: boolean | SchemaObject;
  nullable?: boolean;
  $ref?: string;
};

export type MediaTypeObject = {
  schema?: SchemaObject;
};

export type ResponseObject = {
  description: string;
  content?: Record<string, MediaTypeObject>;
};

export type ParameterObject = {
  name: string;
  in: "query" | "path";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
};

export type RequestBodyObject = {
  required?: boolean;
  content: Record<string, MediaTypeObject>;
};

export type OperationObject = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
};

export type PathItemObject = Partial<Record<string, OperationObject>>;

export type PathsObject = Record<string, PathItemObject>;

export type ComponentsObject = {
  schemas?: Record<string, SchemaObject>;
  responses?: Record<string, ResponseObject>;
  parameters?: Record<string, ParameterObject>;
  requestBodies?: Record<string, RequestBodyObject>;
};

export type OpenAPIDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  paths: PathsObject;
  components?: ComponentsObject;
};
