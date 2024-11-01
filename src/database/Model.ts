import { sql } from "./sql";

// "GENERATED" TYPES

type UserData = {
  id: number;
  username: string;
  password: string;
  name: string | null;
  avatar_id: number;
};
type UserAutoGenerated = "id";
type UserOptional = "name";
type UserRelationship = {
  avatar_id: AvatarData;
};
type AvatarData = {
  id: number;
  src: string;
  alt: string | null;
};
// type AvatarRelationship = {};

// UTILITY TYPES

// I have no idea what I'm doing but this appears to work
// T extends null will result in "boolean" instead of true for some reason (perhaps because T extends unknown | null??)
// but false works just fine, so we check for that and "force" the "boolean" into a "true"
type IsNotNullable<T> = (T extends null ? true : false) extends false
  ? true
  : false;

type Nullable<T> = T | null;

type OneOf<T> = {
  [K in keyof T]: Pick<T, K>;
}[keyof T];

// Relationships will have some of Data's keys, leading to another, different Data type
type BaseRelationship<Data> = Partial<Record<keyof Data, unknown>>;

type NonNullValue<NonNull extends true | false, value> = NonNull extends true
  ? value
  : value | null;

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

class Model<
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
        const selector = `${parentTable}.${key}`;

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
    const columns =
      select.length > 0
        ? select.map((column) => sql(`${this.tableName}.${String(column)}`))
        : sql.unsafe("*");

    // const includeColumns = Object.entries(include).map(([key, value]) => {
    //   if(typeof value === "boolean") {
    //     return
    //   }
    //   // `${this.getTableFromId(key)}.${}`
    // });
    // @todo columns also need to modify left join

    const result = await sql`
      SELECT ${columns} FROM ${sql(this.tableName)}
      ${sql.unsafe(this.generateWhere(where))}
    `;
    return result.length > 0 ? (result[0] as any) : null;
  }

  async update({
    data,
    where,
  }: {
    data: Partial<ModelData>;
    where: WhereOperator<ModelData, ModelRelationship>;
  }) {
    return sql`
      UPDATE ${sql(this.tableName)} SET ${sql(data as any, Object.keys(data))}
      ${sql.unsafe(this.generateWhere(where))} 
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

const user = new Model<
  UserData,
  UserAutoGenerated,
  UserOptional,
  UserRelationship
>("user_");

// https://www.w3schools.com/sql/sql_like.asp

async function main() {
  // await user.create({
  //   data: {
  //     username: "string",
  //     password: "string",
  //     avatar_id: 1,
  //   },
  // });

  const found = await user.find({
    where: {
      username: {
        contains: "ing",
      },
      name: null,
    },
  });
  if (found) {
    console.log(found);
  }

  process.exit(0);
}

main();
