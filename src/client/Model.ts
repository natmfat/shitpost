import { sql } from "./sql";
import { OneOf, Nullable, IsNotNullable } from "../types";

// Relationships will have some of Data's keys, leading to another, different Data type
type BaseRelationship<Data> = Partial<Record<keyof Data, unknown>>;

type NonNullValue<NonNull extends true | false, value> = NonNull extends true
  ? value
  : value | null;

// @todo order desc/asc

type WhereOperatorString<NonNull extends true | false> =
  | OneOf<{
      eq: NonNullValue<NonNull, string>;
      neq: NonNullValue<NonNull, string>;
      contains: string;
      endsWith: string;
      startsWith: string;
    }>
  | NonNullValue<NonNull, string>;

type WhereOperatorNumber<NonNull extends true | false> =
  | OneOf<{
      eq: NonNullValue<NonNull, number>;
      neq: NonNullValue<NonNull, number>;
      gt: number;
      lt: number;
      gte: number;
      lte: number;
      // @todo between?
    }>
  | NonNullValue<NonNull, number>;

type WhereOperatorBoolean<NonNull extends true | false> =
  | OneOf<{
      eq: NonNullValue<NonNull, boolean>;
      neq: NonNullValue<NonNull, boolean>;
    }>
  | NonNullValue<NonNull, boolean>;

// this "maps" a type of a value of Data to a the corresponding operators
// prettier-ignore
type WhereOperatorMap<Value> = NonNullable<Value> extends string
  ? WhereOperatorString<IsNotNullable<Value>>
  : NonNullable<Value> extends number
    ? WhereOperatorNumber<IsNotNullable<Value>>
    : NonNullable<Value> extends boolean
      ? WhereOperatorBoolean<IsNotNullable<Value>>
      : never;

type WhereOperator<
  BaseData,
  Relationship extends BaseRelationship<BaseData>
> = Partial<{
  [Key in keyof BaseData]: Partial<WhereOperatorMap<BaseData[Key]>>;
}> &
  Partial<{
    // this feels redundant but I guess we have to reaffirm Key is a keyof BaseData?
    [Key in keyof Relationship extends infer _ ? keyof BaseData : never]:
      | BaseData[Key]
      | Partial<{
          [SubKey in keyof Relationship[Key]]: WhereOperatorMap<
            Relationship[Key][SubKey]
          >;
        }>;
  }>;

// @todo more than 1 relationship (use WhereOperator<value, value> if extends?)

type IncludeOperator<
  Data,
  Relationship extends BaseRelationship<Data>
> = Partial<{
  [Key in keyof Relationship]:
    | boolean
    | Partial<{
        [SubKey in keyof Relationship[Key]]: boolean;
      }>;
}>;

// METHOD ARGUMENTS & RETURN TYPES

// DataArg is what's used in queries
// it excludes autogenerated keys & makes default values optional
// BaseData is UserData, no adjustments made
type DataArg<
  ModelData extends Record<string, unknown>,
  ModelAutoGenerated extends keyof ModelData,
  ModelOptional extends keyof ModelData
> = Omit<ModelData, ModelAutoGenerated | ModelOptional> &
  Partial<Pick<ModelData, ModelOptional>>;

export class Model<
  ModelData extends Record<string, unknown>,
  ModelAutoGenerated extends keyof ModelData,
  ModelOptional extends keyof ModelData,
  ModelRelationship extends BaseRelationship<ModelData>
> {
  constructor(private tableName: string) {}

  // @todo this should not exist, use mock db instead
  // private getTableFromId(key: string) {
  //   return key.endsWith("id") ? key.substring(0, key.length - 2) : key;
  // }

  private createIdentifier(
    column: string,
    parentTable: string = this.tableName
  ) {
    return `${parentTable}.${column}`;
  }

  private generateSelect(select: Array<keyof ModelData>, returning = false) {
    const columns =
      select.length > 0
        ? select.map((column) => sql(this.createIdentifier(String(column))))
        : sql`*`;

    return sql`${returning ? sql`RETURNING ` : sql``}${columns}`;
  }

  private generateWhere<
    WhereData extends Record<string, unknown>,
    WhereRelationship extends BaseRelationship<WhereData>
  >(
    where: WhereOperator<WhereData, WhereRelationship>,
    parentTable: string = this.tableName
  ): string {
    // @todo very bad using unsafe (idk sql injections ok), fix that
    return `WHERE ${Object.entries(where)
      .map(([key, operators]) => {
        const selector = this.createIdentifier(key, parentTable);
        if (typeof operators === "undefined") {
          return;
        } else if (operators === null) {
          return `${selector} IS NULL`;
        } else if (operators && typeof operators === "object") {
          // @todo check if key is a relationship w/ mock db (if it is, then )
          // return this.generateWhere(operator as any, this.getTableFromId(key));
          // otherwise, it's an operator
          const [operator, targetValue] = Object.entries(operators)[0];
          switch (operator) {
            case "eq":
              return targetValue === null
                ? `${selector} IS NULL`
                : `${selector} = '${targetValue}'`;
            case "neq":
              return targetValue === null
                ? `${selector} IS NOT NULL`
                : `${selector} != '${targetValue}'`;
            case "contains":
              return `${selector} LIKE '%${targetValue}%'`;
            case "startsWith":
              return `${selector} LIKE '${targetValue}%'`;
            case "endsWith":
              return `${selector} LIKE '%${targetValue}'`;
            case "gt":
              return `${selector} > ${targetValue}`;
            case "lt":
              return `${selector} < ${targetValue}`;
            case "gte":
              return `${selector} >= ${targetValue}`;
            case "lte":
              return `${selector} >= ${targetValue}`;
          }
        }

        return `${selector} = '${operators}'`;
      })
      .join(" AND ")}`;
  }

  async create({
    data,
  }: {
    data: DataArg<ModelData, ModelAutoGenerated, ModelOptional>;
  }) {
    return sql`
      INSERT INTO ${sql(this.tableName)} 
      ${sql(data as any, Object.keys(data))}`;
  }

  // include = {},

  async find<T extends keyof ModelData>({
    select = [],
    where = {},
  }: // include = {},
  {
    select?: Array<T>;
    where?: WhereOperator<ModelData, ModelRelationship>;
    include?: IncludeOperator<ModelData, ModelRelationship>;
  }): Promise<Nullable<Pick<ModelData, T>>> {
    // const includeColumns = Object.entries(include).map(([key, value]) => {
    //   if(typeof value === "boolean") {
    //     return
    //   }
    //   // `${this.getTableFromId(key)}.${}`
    // });
    // @todo columns also need to modify left join

    const result = await sql`
      SELECT ${this.generateSelect(select)} FROM ${sql(this.tableName)}
      ${sql.unsafe(this.generateWhere(where))}
      LIMIT 1
    `;
    // @todo find many
    return result.length > 0 ? (result[0] as any) : null;
  }

  async update<T extends keyof ModelData>({
    select = [],
    data,
    where,
  }: {
    select?: Array<T>;
    data: Partial<ModelData>;
    where: WhereOperator<ModelData, ModelRelationship>;
  }) {
    return sql`
      UPDATE ${sql(this.tableName)} SET ${sql(data as any, Object.keys(data))}
      ${sql.unsafe(this.generateWhere(where))}
      ${this.generateSelect(select, true)}
    `;
  }

  async delete({
    where,
  }: {
    where: WhereOperator<ModelData, ModelRelationship>;
  }) {
    return sql`
      DELETE FROM ${sql(this.tableName)} 
      ${sql.unsafe(this.generateWhere(where))}
    `;
  }
}
