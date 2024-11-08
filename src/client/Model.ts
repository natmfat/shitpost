import { sql } from "./sql";
import { OneOf, IsNotNullable, Nullable, Defined } from "../types";
import { MockColumn, MockDatabase } from "../MockDatabase";
import assert from "assert";

/** ReturnType of sql templating function */
type SqlFragment = ReturnType<typeof sql>;

type BaseData = Record<string, unknown>;

/**
 * A type indicating which of Data's keys are actually foreign relationships to another model
 * @example
 * type UserData = {
 *   avatar_id: number
 * }
 *
 * type UserRelationship = {
 *   avatar_id: AvatarData
 * }
 */
type BaseRelationship<Data extends BaseData> = Partial<
  Record<keyof Data, BaseData>
>;

/**
 * Is the field allowed to be null? \
 * "NonNull" indicates that NOT NULL was specified in the schema
 */
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
  Data extends BaseData,
  Relationship extends BaseRelationship<Data>
> = Partial<{
  [Key in keyof Data]: Partial<WhereOperatorMap<Data[Key]>>;
}> &
  Partial<{
    [Key in keyof Data]:
      | Partial<WhereOperatorMap<Data[Key]>>
      | (Key extends keyof Relationship
          ?
              | Data[Key]
              | Partial<{
                  [SubKey in keyof Relationship[Key]]: WhereOperatorMap<
                    Relationship[Key][SubKey]
                  >;
                }>
          : never);
  }>;

type Order = "ASC" | "DESC";

type OrderByOperator<
  Data extends BaseData,
  Relationship extends BaseRelationship<Data>
> = Partial<
  Omit<Record<keyof Data, Order>, keyof Relationship> & {
    [Key in keyof Relationship]: Partial<{
      [SubKey in keyof Relationship[Key]]: Order;
    }>;
  }
>;

// @todo more than 1 relationship deep -> recursive types (use WhereOperator<value, value> if extends?)

type IncludeOperator<
  Data extends BaseData,
  Relationship extends BaseRelationship<Data>
> = Partial<{
  [Key in keyof Relationship]:
    | boolean
    | Partial<{
        [SubKey in keyof Relationship[Key]]: boolean;
      }>;
}>;

// prettier-ignore
type IncludeOperatorResult<
  Data extends BaseData,
  Relationship extends BaseRelationship<Data>,
  Include extends IncludeOperator<Data, Relationship>
> = {
  [Key in keyof Include]: Include[Key] extends boolean
    ? Key extends keyof Relationship
      ? Relationship[Key]
      : never
    : Include[Key] extends Partial<Record<infer SubKey, boolean>>
      ? Key extends keyof Relationship
        ? Pick<Relationship[Key], Extract<keyof Relationship[Key], SubKey>>
        : never
      : never;
};

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
  /**
   * Create a new typesafe model with a few common utility methods
   * @param tableName Name of the table
   * @param database Mock database to verify relationships between models
   */
  constructor(private tableName: string, private database: MockDatabase) {}

  /**
   * Find a single entry
   * @param args Query modifications
   * @param args.select Select columns you need, defaults to selecting everything
   * @param args.where Condition entry must meet
   * @param args.include Include relationship columns (only 1 level deep), defaults to including nothing
   * @returns A single entry (if found) or null (if not found)
   */
  async find<
    SelectKey extends keyof ModelData,
    ResolvedIncludeOperator extends IncludeOperator<
      ModelData,
      ModelRelationship
    >
  >(args: {
    select?: Array<SelectKey>;
    where?: WhereOperator<ModelData, ModelRelationship>;
    include?: ResolvedIncludeOperator;
  }) {
    const data = await this.findMany({ ...args, limit: 1 });
    return data.length === 1 ? data[0] : null;
  }

  /**
   * Find multiple entries
   * @param args Query modifications
   * @param args.select Select columns you need, defaults to selecting everything
   * @param args.where Condition entries must meet
   * @param args.include Include relationship columns (only 1 level deep), defaults to including nothing
   * @param args.limit Limit the number of returned entries
   * @param args.orderBy Sort entries by column
   * @returns An array of entries
   */
  async findMany<
    SelectKey extends keyof ModelData,
    ResolvedIncludeOperator extends IncludeOperator<
      ModelData,
      ModelRelationship
    >
  >(args: {
    select?: Array<SelectKey>;
    where?: WhereOperator<ModelData, ModelRelationship>;
    include?: ResolvedIncludeOperator;
    limit?: number;
    orderBy?: OrderByOperator<ModelData, ModelRelationship>;
  }) {
    const { select = [], where = {}, include = {}, limit, orderBy = {} } = args;
    const { joinFragment, selectFragment: includeSelectFragment } =
      this.generateInclude(include);

    const rows = await sql`
      SELECT ${this.generateSelect({
        select,
        includeComma: includeSelectFragment.length > 0,
      })} ${this.clearFragmentArray(includeSelectFragment)} FROM ${sql(
      this.tableName
    )}
      ${this.clearFragmentArray(joinFragment)}
      ${this.generateWhere({ where })}
      ${limit ? sql`LIMIT ${limit}` : sql``}
      ${this.generateOrderBy({ orderBy })}
    `;

    return rows.map(
      (row) =>
        this.formatRow(row) as Omit<
          Pick<ModelData, SelectKey>,
          keyof ResolvedIncludeOperator
        > &
          IncludeOperatorResult<
            ModelData,
            ModelRelationship,
            ResolvedIncludeOperator
          >
    );
  }

  /**
   * Create a new entry
   * @param args Query modifications
   * @param args.select Select columns that should be returned
   * @param args.data Data to insert into the table
   * @returns Created data
   */
  async create<SelectKey extends keyof ModelData>(args: {
    select?: Array<SelectKey>;
    data: DataArg<ModelData, ModelAutoGenerated, ModelOptional>;
  }) {
    const { select = [], data } = args;
    const rows = await sql`
      INSERT INTO ${sql(this.tableName)} 
      ${sql(data as any, Object.keys(data))}
      ${this.generateSelect({ select, includeReturning: true })}
    `;
    assert(rows.length === 1, "expected to create a single row");
    return rows[0] as Pick<ModelData, SelectKey>;
  }

  /**
   * Update an existing entry
   * @param args Query modifications
   * @param args.select Select columns that should be returned
   * @param args.data Update data
   * @param args.where Condition entry must meet
   * @returns New, updated data
   */
  async update<SelectKey extends keyof ModelData>(args: {
    select?: Array<SelectKey>;
    data: Partial<ModelData>;
    where: WhereOperator<ModelData, ModelRelationship>;
  }) {
    const { select = [], data, where } = args;
    const rows = await sql`
      UPDATE ${sql(this.tableName)} SET ${sql(data as any, Object.keys(data))}
      ${this.generateWhere({ where })}
      ${this.generateSelect({ select, includeReturning: true })}
    `;
    assert(rows.length === 1, "expected to update a single row");
    return rows[0] as Pick<ModelData, SelectKey>;
  }

  /**
   * Remove an entry
   * @param args Query modifications
   * @param args.where Condition entry must meet
   */
  async delete(args: { where: WhereOperator<ModelData, ModelRelationship> }) {
    const { where } = args;
    return sql`
      DELETE FROM ${sql(this.tableName)} 
      ${this.generateWhere({ where })}
    `;
  }

  /** Generate the SQL statements for each method (find, create, etc.)  */

  private generateSelect({
    select,
    parentTable = this.tableName,
    referenceColumnName,
    includeReturning = false,
    includeComma = false,
  }: {
    // columns that we are selecting from the table
    select: Array<keyof ModelData>;
    // table that the columns belong to
    parentTable?: string;
    // if provided, alias the column into __referenceColumnName__column
    // where column is a key of select
    referenceColumnName?: string;
    // should we prefix the select statement with RETURNING
    includeReturning?: boolean;
    // if there are more select statements later on, this will add a comma at the end
    includeComma?: boolean;
  }): SqlFragment {
    const columns =
      select.length > 0
        ? this.joinByFragment(
            select.map(
              (column) =>
                sql`${this.createIdentifier(String(column), parentTable)} ${
                  referenceColumnName
                    ? sql`AS ${sql(
                        `__${referenceColumnName}__${String(column)}`
                      )}`
                    : sql``
                }`
            ),
            sql`, `
          )
        : sql`${sql(parentTable)}.*`;

    return sql`${includeReturning ? sql`RETURNING` : sql``} ${columns}${
      includeComma ? sql`,` : sql``
    }`;
  }

  private generateInclude(
    include: IncludeOperator<ModelData, ModelRelationship>
  ) {
    const joinFragment: SqlFragment[] = [];
    const selectFragment: SqlFragment[] = [];

    for (const [columnName, select] of Object.entries(include)) {
      const column = this.findReference(columnName);

      joinFragment.push(
        sql`JOIN ${sql(column.reference.tableName)} ON ${this.createIdentifier(
          column.name
        )} = ${this.createIdentifier(
          column.reference.columnName,
          column.reference.tableName
        )}`
      );
      if (typeof select !== "boolean") {
        selectFragment.push(
          this.generateSelect({
            select: Object.keys(select),
            parentTable: column.reference.tableName,
            referenceColumnName: columnName,
          })
        );
      }
    }

    return {
      joinFragment: joinFragment,
      selectFragment: selectFragment,
    };
  }

  private generateWhereObject(
    key: string,
    operators: unknown,
    parentTable: string = this.tableName
  ): SqlFragment {
    const selector = this.createIdentifier(key, parentTable);
    if (operators === null) {
      return sql`${selector} IS NULL`;
    } else if (operators && typeof operators === "object") {
      let column: Nullable<Defined<MockColumn, "reference">> = null;
      try {
        column = this.findReference(key, parentTable);
      } catch (error) {}
      if (column) {
        return this.generateWhere({
          where: operators as any,
          parentTable: column.reference.tableName,
          includeWhere: false,
        });
      }

      const [operator, targetValue] = Object.entries(operators)[0];
      switch (operator) {
        case "eq":
          return targetValue === null
            ? sql`${selector} IS NULL`
            : sql`${selector} = '${targetValue}'`;
        case "neq":
          return targetValue === null
            ? sql`${selector} IS NOT NULL`
            : sql`${selector} != '${targetValue}'`;
        case "contains":
          return sql`${selector} LIKE '%${targetValue}%'`;
        case "startsWith":
          return sql`${selector} LIKE '${targetValue}%'`;
        case "endsWith":
          return sql`${selector} LIKE '%${targetValue}'`;
        case "gt":
          return sql`${selector} > ${targetValue}`;
        case "lt":
          return sql`${selector} < ${targetValue}`;
        case "gte":
          return sql`${selector} >= ${targetValue}`;
        case "lte":
          return sql`${selector} >= ${targetValue}`;
      }
    }

    return sql`${selector} = ${String(operators)}`;
  }

  private generateWhere<
    WhereData extends Record<string, unknown>,
    WhereRelationship extends BaseRelationship<WhereData>
  >({
    where,
    parentTable = this.tableName,
    includeWhere = true,
  }: {
    where: WhereOperator<WhereData, WhereRelationship>;
    parentTable?: string;
    /**
     * should we prefix the where statement with WHERE
     * this only occurs IF the where operator produces a meaningful result
     */
    includeWhere?: boolean;
  }): SqlFragment {
    const whereFragments: SqlFragment[] = [];
    const whereEntries = Object.entries(where);
    whereEntries.forEach(([key, operators]) => {
      whereFragments.push(
        this.generateWhereObject(key, operators, parentTable)
      );
    });

    return sql`${
      includeWhere && whereFragments.length > 0 ? sql`WHERE` : sql``
    } ${this.joinByFragment(whereFragments, sql` AND `)}`;
  }

  private generateOrderByObject({
    orderBy = {},
    parentTable = this.tableName,
  }: {
    orderBy: OrderByOperator<ModelData, ModelRelationship>;
    parentTable?: string;
  }) {
    const ascFragment: SqlFragment[] = [];
    const descFragment: SqlFragment[] = [];

    for (const [columnName, order] of Object.entries(orderBy)) {
      if (order === "DESC") {
        descFragment.push(
          sql`${this.createIdentifier(columnName, parentTable)}`
        );
      } else if (order === "ASC") {
        ascFragment.push(
          sql`${this.createIdentifier(columnName, parentTable)}`
        );
      }

      let column: Nullable<MockColumn> = null;
      try {
        column = this.findReference(columnName);
      } catch (error) {}
      if (column && column.reference) {
        const fragments = this.generateOrderByObject({
          orderBy: order,
          parentTable: column.reference.tableName,
        });
        ascFragment.push(...fragments.ascFragment);
        descFragment.push(...fragments.descFragment);
      }
    }

    return { ascFragment, descFragment };
  }

  private generateOrderBy({
    orderBy = {},
  }: {
    orderBy: OrderByOperator<ModelData, ModelRelationship>;
  }) {
    const { ascFragment, descFragment } = this.generateOrderByObject({
      orderBy,
    });

    const hasAsc = ascFragment.length > 0;
    const hasDesc = descFragment.length > 0;

    if (!hasAsc && !hasDesc) {
      return sql``;
    }

    return sql`
      ORDER BY 
        ${
          hasAsc
            ? sql`${this.joinByFragment(ascFragment, sql`, `)} ASC${
                hasDesc ? sql`, ` : sql``
              }`
            : sql``
        } 
        ${
          hasDesc
            ? sql`${this.joinByFragment(descFragment, sql`, `)} DESC`
            : sql``
        }
    `;
  }

  /**
   * Random utilities that do not necessarily generate SQL fragments
   */

  /**
   * Create an identifier for a column
   * @param column Column name
   * @param parentTable Parent table to use
   * @returns SQL identifier that can be included in fragments
   */
  private createIdentifier(
    column: string,
    parentTable: string = this.tableName
  ) {
    return sql(`${parentTable}.${column}`);
  }

  /**
   * Join SQL fragments together with another SQL fragment \
   * Similar to array.join(<string>)
   * @param fragments Array of SQL fragments
   * @param joinBy SQL fragment used to join array together
   * @returns A single SQL fragment separated by `joinBy`
   */
  private joinByFragment(
    fragments: SqlFragment[],
    joinBy: SqlFragment
  ): SqlFragment {
    if (fragments.length === 0) {
      return sql``;
    }

    return sql`${fragments.map(
      (fragment, i) =>
        sql`${fragment}${i !== fragments.length - 1 ? joinBy : sql``}`
    )}`;
  }

  /**
   * Given an array of sql statements, return an empty sql string or the array \
   * If you provide sql`[]` (where fragment is an empty array) unexpected things happen, so we force it into sql`` instead
   * @param fragment Array of sql statements that could be empty
   * @returns A non-empty array of sql statements OR an empty sql string
   */
  private clearFragmentArray(fragment: SqlFragment[]) {
    return fragment.length === 0 ? sql`` : fragment;
  }

  /**
   * Get and verify that a relationship exists given a column name and its parent table \
   * Will throw error if reference is not found
   * @param columnName Name of the column that may have a reference
   * @param parentTable Parent table containing the column
   * @returns MockColumn that is guaranteed to have a reference
   */
  private findReference(
    columnName: string,
    parentTable: string = this.tableName
  ) {
    const column = this.database.getTable(parentTable).getColumn(columnName);
    assert(
      column,
      `expected to find column "${columnName}" in table "${parentTable}"`
    );
    assert(
      column.reference,
      `expected column "${columnName}" in table "${parentTable}" to have a reference`
    );

    return column as Defined<MockColumn, "reference">;
  }

  /**
   * Properly format row into its expected type
   * @param rowSource Row returned from postgres querys
   * @returns Properly formatted row (must be typed later)
   *
   * @example
   * formatRow({
   *   id: '1393ca77-391a-4cb7-9aca-4c9a905fc3fa',
   *   palette_id: '2',
   *  __palette_id_id: '2',
   *   __palette_id_thumbnail_colors: [ '#0e1525', '#1c2333', '#0053a6', '#0079f2' ]
   * })
   * // this will produce the object
   * // this will correspond to our later type casts
   * {
   *   id: '1393ca77-391a-4cb7-9aca-4c9a905fc3fa',
   *   palette_id: {
   *     id: '2',
   *     thumbnail_colors: [ '#0e1525', '#1c2333', '#0053a6', '#0079f2' ]
   *   }
   * }
   */
  private formatRow(rowSource: Record<string, unknown>) {
    // make a copy cause immutable data & pure functions or whatever
    const row = { ...rowSource };
    for (const key of Object.keys(row)) {
      // if starts with __, like __palette_id__thumbnail_colors
      // we should remove it & add all keys to palette_id
      if (key.startsWith("__")) {
        const cachedValue = row[key];
        delete row[key];
        const [referenceColumnName, subKey] = key
          .split("__")
          .map((row) => row.trim())
          .filter((row) => row.length > 0) as [keyof typeof row, string];
        row[referenceColumnName] = {
          ...(typeof row[referenceColumnName] === "object"
            ? row[referenceColumnName]
            : {}),
          [subKey]: cachedValue,
        };
      }
    }
    return row;
  }
}
