// prisma-type-mapper.ts
// Maps Prisma scalar types to @mostajs/orm FieldType.
// Emits warnings for lossy conversions.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { FieldType } from '@mostajs/orm';
import { WarningCode, type AdapterOptions, type AdapterWarning } from '../core/types.js';

export interface PrismaTypeMapping {
  type: FieldType;
  /** EntitySchema doesn't preserve precision — capture here if important */
  meta?: {
    /** Original Prisma scalar (Int, BigInt, Decimal...) */
    prismaType?: string;
    /** maxLength from @db.VarChar(N) */
    maxLength?: number;
    /** precision/scale from @db.Decimal(p, s) */
    precision?: number;
    scale?: number;
  };
}

/**
 * Map a Prisma scalar type name to @mostajs/orm FieldType.
 *
 * Lossy mappings emit warnings:
 *  - BigInt → number (precision loss beyond 2^53)
 *  - Decimal → number (arbitrary precision lost)
 *  - Bytes → string (base64 encoding, no native blob in EntitySchema)
 *
 * Unknown types are treated as enum references (caller resolves).
 */
export function mapPrismaScalar(
  prismaType: string,
  fieldName: string,
  entityName: string,
  opts: AdapterOptions | undefined,
  emitWarning: (w: AdapterWarning) => void
): PrismaTypeMapping | null {
  switch (prismaType) {
    case 'String':
      return { type: 'string', meta: { prismaType } };

    case 'Boolean':
      return { type: 'boolean', meta: { prismaType } };

    case 'Int':
      return { type: 'number', meta: { prismaType } };

    case 'Float':
      return { type: 'number', meta: { prismaType } };

    case 'DateTime':
      return { type: 'date', meta: { prismaType } };

    case 'Json':
      return { type: 'json', meta: { prismaType } };

    case 'BigInt':
      emitWarning({
        code: WarningCode.LOSSY_CONVERSION,
        message: `BigInt field "${fieldName}" mapped to number; values > 2^53 will lose precision`,
        entity: entityName,
        field: fieldName,
      });
      return { type: 'number', meta: { prismaType } };

    case 'Decimal':
      emitWarning({
        code: WarningCode.LOSSY_CONVERSION,
        message: `Decimal field "${fieldName}" mapped to number; arbitrary precision is not preserved`,
        entity: entityName,
        field: fieldName,
      });
      return { type: 'number', meta: { prismaType } };

    case 'Bytes':
      emitWarning({
        code: WarningCode.LOSSY_CONVERSION,
        message: `Bytes field "${fieldName}" mapped to string (base64); binary handling must be done by application`,
        entity: entityName,
        field: fieldName,
      });
      return { type: 'string', meta: { prismaType } };

    default:
      // Unknown — caller decides if it's an enum, relation, or error
      return null;
  }
}

/**
 * Parse an @db.XYZ attribute and extract length/precision metadata.
 * Used to enrich meta on the mapping (not persisted in EntitySchema).
 */
export function extractDbMetadata(
  dbAttrName: string,
  args: unknown[]
): Partial<PrismaTypeMapping['meta']> {
  const meta: Partial<PrismaTypeMapping['meta']> = {};

  switch (dbAttrName) {
    case 'VarChar':
    case 'Char':
    case 'NVarChar': {
      const len = toNumber(args[0]);
      if (len != null) meta.maxLength = len;
      break;
    }
    case 'Decimal':
    case 'Numeric': {
      const p = toNumber(args[0]);
      const s = toNumber(args[1]);
      if (p != null) meta.precision = p;
      if (s != null) meta.scale = s;
      break;
    }
  }

  return meta;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}
