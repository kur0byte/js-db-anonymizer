# Database Anonymization Tool 🚀

Hey devs! 👋 Welcome to the ultimate solution for anonymizing your PostgreSQL database dumps like a pro. Whether you’re sharing data or testing in non-production environments, this tool ensures your sensitive information stays safe and sound. 💾✨

---

## Features 🔥

- **Dump Creation**: Seamlessly create PostgreSQL database dumps.
- **Data Anonymization**: Apply customizable masking rules to protect sensitive data.
- **Docker Integration**: Effortlessly run PostgreSQL with the Anonymizer extension inside Docker containers.
- **Enhanced Compatibility**: Generate dumps that work on any PostgreSQL installation—no extensions required.
- **Detailed Logs**: Track everything with comprehensive logging powered by Winston.

---

## Prerequisites 🛠️

Before you dive in, make sure you have the following:

- **Node.js**: Version 16 or higher.
- **Docker**: Installed and running on your machine.
- **PostgreSQL**: Ensure the source database is PostgreSQL.

---

## Installation 💻

1. Clone the repository:
   ```sh
   git clone https://github.com/kur0byte/js-db-anonymizer.git
   
   cd js-db-anonymizer
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

---

## Usage 🎯

### Command Line Interface (CLI)

Run the program to anonymize a dump:

```sh
./main.js -d <dump.sql> -r <rules.js> -o <output.sql> -dbE <postgres>
```

**Parameters:**
- `-d, --dump <path>`: Path to the original dump file.
- `-r, --rules <path>`: Path to the anonymization rules file.
- `-o, --output <path>`: Output file name for anonymized dump.
- `-dbE, --databaseEngine <path>`: Engine of the database to Dump.

### Example

```sh
node main.js -d dump.sql -r users.rules.js -o Customers -dbE postgres
```

---

### **About Anonymization Rules** 🛡️

1. **Location:** Place your anonymization rules in the `src/rules` folder.
2. **Format:** Rules should be a JavaScript file structured as a JSON-like object.
   - **Top Level:** Define the table name you want to anonymize.
   - **Inside `masks`:** Specify the columns to anonymize and the masking function to apply.
   - **Example:**
   ```javascript
   export const usersRules = {
     users: {
       masks: {
         first_name: `anon.dummy_first_name()`,
         last_name: `anon.dummy_last_name()`,
         email: 'anon.partial_email(email)',
         password_hash: `anon.random_string(15)`,
       }
     }
   };
   ```

### **Where Is the Final Dump Saved?** 🗂️

- The generated anonymized dump is automatically saved in the `dumps` folder with a timestamped filename for easy identification.  
  **Example Filename:** `2025-01-17T01-58-55_anonymized_Customers.sql`.

### **Detailed Logs** 📝

- **Location:** Logs are stored in the `logs` folder, with separate files for errors (`error.log`) and functional events (`combined.log`).
- **Purpose:** These logs help troubleshoot any issues that arise during the anonymization or configuration process.

For more masking functions, check out the [PostgreSQL Anonymizer Docs](https://postgresql-anonymizer.readthedocs.io/en/stable/masking_functions/).

---

## How It Works 🛠️

### 1. **Dump Preprocessing**:
   - Escapes problematic characters (`'` → `''`).
   - Adjusts invalid settings for generic PostgreSQL compatibility.

### 2. **Setup & Anonymization**:
   - Loads and applies masking rules to specified tables and columns.

### 3. **Final Dump Generation**:
   - Cleans up dependencies on the `anon` extension.
   - Creates a fully anonymized dump compatible with any PostgreSQL installation.

---

## Contributing 🤝

Got ideas or improvements? Contributions are welcome! Open an issue or submit a pull request.

---

## License 📜

This project is licensed under the MIT License. Go ahead and make magic happen! ✨

## Autor ✒️

* **Santiago Zapata** - *Solutions Architect* - [Kuro](https://github.com/kur0byte)
* **Franz Suárez** - *Backend Developer* - [fsuarezr](https://github.com/fsuarezr)

🧑‍💻 Made with ❤️ by [fsuarezr](https://github.com/fsuarezr) and [Kuro](https://github.com/kur0byte) 🤘 