# Database Anonymization Tool

## Overview

This project is a tool designed to anonymize database dumps. It leverages PostgreSQL and the PostgreSQL Anonymizer extension to mask sensitive data in database dumps, ensuring that the data can be safely shared or used in non-production environments.

## Features

- **Database Dump Creation**: Create dumps of your PostgreSQL database.
- **Anonymization**: Apply anonymization rules to mask sensitive data.
- **Docker Integration**: Uses Docker to run PostgreSQL with the Anonymizer extension.
- **Logging**: Comprehensive logging using Winston.

## Prerequisites

- **Node.js**: Ensure you have Node.js installed.
- **Docker**: Docker must be installed and running on your machine.
- **PostgreSQL**: The tool is designed to work with PostgreSQL databases.

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/kur0byte/js-db-anonymizer.git
   cd js-db-anonymizer
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

## Usage

### Command Line Interface

The tool provides a CLI for creating and anonymizing database dumps.

```sh
./main.js -d <path_to_dump> -r <path_to_rules> -o <output_file>
```

- `-d, --dump <path>`: Path to the original dump file.
- `-r, --rules <path>`: Path to the rules file.
- `-o, --output <path>`: Output file name for the anonymized dump.

### Example

```sh
./main.js -d dumps/original_dump.sql -r src/rules/users.rules.js -o anonymized_dump
```

## Configuration

### Logger

The logger is configured using Winston and logs to both the console and files.

```javascript
// filepath: /Users/kur0-hf/Documents/personal-repos/db_anon/src/utils/logger.js
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
});
```

### Anonymization Rules

Anonymization rules are defined in JavaScript files. Here is an example rule file:

```javascript
// filepath: /Users/kur0-hf/Documents/personal-repos/db_anon/src/rules/users.rules.js
export const testDbRules = {
  users: {
    masks: {
      first_name: `anon.dummy_first_name()`,
      last_name: `anon.dummy_last_name()`,
      email: 'anon.partial_email(email)',
      password_hash: `anon.random_string(15)`,
      created_at: 'anon.random_date()',
      date_of_birth: 'anon.random_date()',
      last_login: 'anon.random_date()'
    }
  }
}
```
For further information of the anonymization functions please refer to the [Postgres Anonymization Docs](https://postgresql-anonymizer.readthedocs.io/en/stable/masking_functions/).

## Development

<!-- ### Project Structure

- `src/utils`: Utility functions including logger and configuration loaders.
- `src/services`: Core services for dumping and anonymizing databases.
- `src/rules`: Anonymization rules.
- `main.js`: Entry point for the CLI. -->

<!-- ### Running Tests -->

<!-- To run tests, use the following command: -->

<!-- ```sh
npm test
``` -->

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
