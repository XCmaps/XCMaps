#!/usr/bin/env python3
"""
SRTM Elevation Data Import Script

This script imports NASA SRTM elevation data into a PostgreSQL database.
It supports multithreading for improved performance.

Usage:
    python import_srtm.py [--threads N] [--batch-size N] [--srtm-dir PATH] [--db-host HOST] [--db-port PORT] [--db-name NAME] [--db-user USER] [--db-password PASSWORD]

Options:
    --threads N         Number of worker threads to use (default: number of CPU cores)
    --batch-size N      Number of points to insert in a single batch (default: 10000)
    --srtm-dir PATH     Path to the directory containing SRTM data files (default: ./SRTM)
    --db-host HOST      PostgreSQL host (default: localhost)
    --db-port PORT      PostgreSQL port (default: 5432)
    --db-name NAME      PostgreSQL database name (default: from environment variable DB_NAME)
    --db-user USER      PostgreSQL user (default: from environment variable DB_USER)
    --db-password PASS  PostgreSQL password (default: from environment variable DB_PASSWORD)
"""

import os
import sys
import glob
import argparse
import subprocess
import tempfile
import threading
import queue
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
import multiprocessing
import platform

# Function to check and install dependencies
def check_and_install_dependencies():
    # List of required Python packages
    required_packages = ['psycopg2-binary', 'python-dotenv']
    
    # Check and install Python packages
    try:
        import pip
        import importlib
        
        for package in required_packages:
            try:
                importlib.import_module(package.replace('-binary', ''))
                print(f"✓ {package} is already installed")
            except ImportError:
                print(f"Installing {package}...")
                subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
                print(f"✓ {package} installed successfully")
    except Exception as e:
        print(f"Error checking/installing Python packages: {e}")
        print("Please install the required packages manually:")
        print("pip install psycopg2-binary python-dotenv")
    
    # Check for GDAL
    gdal_installed = False
    
    # On Windows, check for common GDAL commands
    if platform.system() == "Windows":
        gdal_commands = ['gdal_translate', 'ogr2ogr', 'gdalinfo']
        for cmd in gdal_commands:
            try:
                result = subprocess.run([cmd, '--version'],
                                      stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE,
                                      text=True,
                                      shell=True)  # Use shell=True on Windows
                if result.returncode == 0:
                    print(f"✓ GDAL is installed (detected via {cmd}, version: {result.stdout.strip()})")
                    gdal_installed = True
                    break
            except Exception as e:
                print(f"Error checking {cmd}: {e}")
    else:
        # On Unix systems, try standard checks
        try:
            result = subprocess.run(['gdal-config', '--version'],
                                   stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,
                                   text=True)
            if result.returncode == 0:
                print(f"✓ GDAL is installed (version: {result.stdout.strip()})")
                gdal_installed = True
        except:
            try:
                result = subprocess.run(['gdal_translate', '--version'],
                                       stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE,
                                       text=True)
                if result.returncode == 0:
                    print(f"✓ GDAL is installed (version: {result.stdout.strip()})")
                    gdal_installed = True
            except:
                gdal_installed = False
    
    if not gdal_installed:
        print("GDAL is not installed or not in PATH")
        
        # Attempt to install GDAL based on the operating system
        system = platform.system()
        if system == "Linux":
            try:
                # Try to detect the Linux distribution
                if os.path.exists('/etc/debian_version'):
                    print("Detected Debian/Ubuntu system")
                    print("Attempting to install GDAL...")
                    subprocess.check_call(['sudo', 'apt-get', 'update'])
                    subprocess.check_call(['sudo', 'apt-get', 'install', '-y', 'gdal-bin'])
                    print("✓ GDAL installed successfully")
                elif os.path.exists('/etc/redhat-release'):
                    print("Detected Red Hat/CentOS/Fedora system")
                    print("Attempting to install GDAL...")
                    subprocess.check_call(['sudo', 'yum', 'install', '-y', 'gdal'])
                    print("✓ GDAL installed successfully")
                else:
                    print("Unable to detect Linux distribution")
                    print("Please install GDAL manually:")
                    print("Debian/Ubuntu: sudo apt-get install gdal-bin")
                    print("Red Hat/CentOS: sudo yum install gdal")
            except Exception as e:
                print(f"Error installing GDAL: {e}")
                print("Please install GDAL manually:")
                print("Debian/Ubuntu: sudo apt-get install gdal-bin")
                print("Red Hat/CentOS: sudo yum install gdal")
        elif system == "Darwin":  # macOS
            try:
                print("Detected macOS")
                print("Attempting to install GDAL using Homebrew...")
                # Check if Homebrew is installed
                try:
                    subprocess.check_call(['brew', '--version'])
                except:
                    print("Homebrew not found. Installing Homebrew...")
                    subprocess.check_call(['/bin/bash', '-c',
                                         '"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'])
                
                # Install GDAL
                subprocess.check_call(['brew', 'install', 'gdal'])
                print("✓ GDAL installed successfully")
            except Exception as e:
                print(f"Error installing GDAL: {e}")
                print("Please install GDAL manually:")
                print("macOS: brew install gdal")
        elif system == "Windows":
            print("Detected Windows system")
            print("Automatic installation of GDAL on Windows is not supported")
            print("Please install GDAL manually:")
            print("1. Download and install OSGeo4W from https://trac.osgeo.org/osgeo4w/")
            print("2. Add the OSGeo4W bin directory to your PATH")
            print("   (e.g., C:\\OSGeo4W64\\bin)")
        else:
            print(f"Unsupported operating system: {system}")
            print("Please install GDAL manually")
        
        # Check again if GDAL was installed
        if platform.system() == "Windows":
            gdal_commands = ['gdal_translate', 'ogr2ogr', 'gdalinfo']
            for cmd in gdal_commands:
                try:
                    result = subprocess.run([cmd, '--version'],
                                          stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE,
                                          text=True,
                                          shell=True)  # Use shell=True on Windows
                    if result.returncode == 0:
                        print(f"✓ GDAL is now installed and available (detected via {cmd})")
                        gdal_installed = True
                        break
                except Exception as e:
                    print(f"Error checking {cmd}: {e}")
            
            if not gdal_installed:
                print("GDAL installation could not be verified")
                print("If you've installed GDAL, try restarting your command prompt or PowerShell")
                print("to ensure the environment variables are loaded properly.")
        else:
            try:
                result = subprocess.run(['gdal_translate', '--version'],
                                       stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE)
                if result.returncode == 0:
                    print(f"✓ GDAL is now installed and available")
                    gdal_installed = True
                else:
                    print("GDAL installation could not be verified")
                    gdal_installed = False
            except:
                print("GDAL installation could not be verified")
                gdal_installed = False
    
    # Import required modules after installation
    try:
        import psycopg2
        import psycopg2.extras
        from dotenv import load_dotenv
        
        # Load environment variables from .env file
        load_dotenv()
        
        return gdal_installed
    except ImportError as e:
        print(f"Error importing required modules: {e}")
        print("Please install the required packages manually and try again")
        return False

# Check and install dependencies
gdal_available = check_and_install_dependencies()

# Parse command line arguments
def parse_args():
    parser = argparse.ArgumentParser(description='Import SRTM elevation data into PostgreSQL')
    parser.add_argument('--threads', type=int, default=multiprocessing.cpu_count(),
                        help='Number of worker threads (default: number of CPU cores)')
    parser.add_argument('--batch-size', type=int, default=10000,
                        help='Number of points to insert in a single batch (default: 10000)')
    parser.add_argument('--srtm-dir', type=str, default='./SRTM',
                        help='Path to the directory containing SRTM data files (default: ./SRTM)')
    parser.add_argument('--db-host', type=str, default=os.environ.get('DB_HOST', 'localhost'),
                        help='PostgreSQL host (default: from .env DB_HOST or localhost)')
    parser.add_argument('--db-port', type=str, default=os.environ.get('DB_PORT', '5432'),
                        help='PostgreSQL port (default: from .env DB_PORT or 5432)')
    parser.add_argument('--db-name', type=str, default=os.environ.get('DB_NAME', 'xcmaps'),
                        help='PostgreSQL database name (default: from .env DB_NAME or xcmaps)')
    parser.add_argument('--db-user', type=str, default=os.environ.get('DB_USER', 'postgres'),
                        help='PostgreSQL user (default: from .env DB_USER or postgres)')
    parser.add_argument('--db-password', type=str, default=os.environ.get('DB_PASSWORD', ''),
                        help='PostgreSQL password (default: from .env DB_PASSWORD)')
    return parser.parse_args()

# Check if GDAL is installed
def check_gdal():
    # Use shell=True on Windows
    use_shell = platform.system() == "Windows"
    
    try:
        if use_shell:
            # On Windows, use shell=True and the command as a string
            subprocess.run('gdal_translate --version',
                          stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE,
                          check=True,
                          shell=True,
                          text=True)
        else:
            # On Unix, use the command as a list
            subprocess.run(['gdal_translate', '--version'],
                          stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE,
                          check=True)
        return True
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        print(f"GDAL check failed: {e}")
        return False

# Initialize database table
def init_database(conn):
    with conn.cursor() as cur:
        # Create table if it doesn't exist
        cur.execute("""
            CREATE TABLE IF NOT EXISTS srtm_elevation (
                id SERIAL PRIMARY KEY,
                lat DOUBLE PRECISION,
                lon DOUBLE PRECISION,
                elevation INTEGER,
                source_file VARCHAR(255),
                UNIQUE(lat, lon)
            )
        """)
        
        # Create spatial index
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_srtm_elevation_lat_lon 
            ON srtm_elevation(lat, lon)
        """)
        
        conn.commit()
        print("Database table initialized successfully")

# Check if a file has already been imported
def is_file_imported(conn, filename):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM srtm_elevation WHERE source_file = %s",
            (filename,)
        )
        count = cur.fetchone()[0]
        return count > 0

# Extract a zip file
def extract_zip_file(zip_path, srtm_dir):
    try:
        print(f"Extracting {zip_path}...")
        
        # Try using Python's zipfile module first
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(srtm_dir)
            print(f"Successfully extracted {zip_path} using Python zipfile")
            return True
        except Exception as zip_error:
            print(f"Error extracting with Python zipfile: {zip_error}")
            
            # Fall back to system unzip command if available
            try:
                use_shell = platform.system() == "Windows"
                if use_shell:
                    # On Windows, try to use PowerShell's Expand-Archive
                    cmd = f'powershell -command "Expand-Archive -Path \'{zip_path}\' -DestinationPath \'{srtm_dir}\' -Force"'
                    subprocess.run(cmd, shell=True, check=True)
                else:
                    # On Unix, use unzip command
                    subprocess.run(['unzip', '-o', zip_path, '-d', srtm_dir], check=True)
                print(f"Successfully extracted {zip_path} using system command")
                return True
            except Exception as cmd_error:
                print(f"Error extracting with system command: {cmd_error}")
                raise
    except Exception as e:
        print(f"Error extracting {zip_path}: {e}")
        return False

# Convert TIFF to CSV using GDAL
def tiff_to_csv(tiff_path, csv_path):
    # Try multiple approaches to handle different TIFF formats
    approaches = [
        ['gdal_translate', '-of', 'XYZ', tiff_path, csv_path],
        ['gdal_translate', '-of', 'XYZ', '-co', 'FORCE_OVERWRITE=YES', tiff_path, csv_path],
        ['gdal_translate', '-of', 'XYZ', '-b', '1', tiff_path, csv_path],
        ['gdal_translate', '-of', 'XYZ', '-ot', 'Float32', tiff_path, csv_path]
    ]
    
    # Use shell=True on Windows
    use_shell = platform.system() == "Windows"
    
    for cmd in approaches:
        try:
            cmd_str = ' '.join(cmd)
            print(f"Trying GDAL command: {cmd_str}")
            
            if use_shell:
                # On Windows, use shell=True and the command as a string
                result = subprocess.run(cmd_str, check=True, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, shell=True, text=True)
            else:
                # On Unix, use the command as a list
                result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
                
            print(f"Successfully extracted data using command: {cmd_str}")
            return True
        except subprocess.SubprocessError as e:
            print(f"Error using command {' '.join(cmd)}: {e}")
    
    print(f"Failed to extract data from {tiff_path} using all available approaches")
    return False

# Worker function to process CSV data
def process_csv_worker(csv_queue, db_params, batch_size):
    # Connect to database
    conn = psycopg2.connect(**db_params)
    conn.autocommit = False
    
    while True:
        try:
            # Get a task from the queue
            task = csv_queue.get()
            if task is None:  # Poison pill to signal shutdown
                break
                
            csv_path, source_file = task
            print(f"Processing {csv_path}...")
            
            # Process the CSV file
            batch = []
            processed_count = 0
            skipped_count = 0
            
            with open(csv_path, 'r') as f:
                for line in f:
                    try:
                        # Parse the line (format: lon lat elevation)
                        parts = line.strip().split()
                        if len(parts) < 3:
                            continue
                            
                        lon = float(parts[0])
                        lat = float(parts[1])
                        elevation = float(parts[2])
                        
                        # Skip points with elevation <= 0
                        if elevation <= 0:
                            skipped_count += 1
                            continue
                            
                        batch.append((lat, lon, int(elevation), source_file))
                        
                        # Insert batch when it reaches the batch size
                        if len(batch) >= batch_size:
                            insert_batch(conn, batch)
                            processed_count += len(batch)
                            batch = []
                            
                            # Print progress
                            if processed_count % (batch_size * 10) == 0:
                                print(f"Processed {processed_count} points from {source_file}")
                    except Exception as e:
                        print(f"Error processing line in {csv_path}: {e}")
                        continue
            
            # Insert any remaining points
            if batch:
                insert_batch(conn, batch)
                processed_count += len(batch)
            
            print(f"Completed {csv_path}: Processed {processed_count} points, Skipped {skipped_count} points")
            
            # Clean up the temporary CSV file
            try:
                os.remove(csv_path)
                print(f"Removed temporary file {csv_path}")
            except Exception as e:
                print(f"Error removing temporary file {csv_path}: {e}")
                
        except Exception as e:
            print(f"Worker error: {e}")
        finally:
            csv_queue.task_done()
    
    # Close database connection
    conn.close()

# Insert a batch of points into the database
def insert_batch(conn, batch):
    with conn.cursor() as cur:
        try:
            # Use psycopg2's execute_values for efficient batch insert
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO srtm_elevation (lat, lon, elevation, source_file)
                VALUES %s
                ON CONFLICT (lat, lon) DO UPDATE SET
                    elevation = EXCLUDED.elevation,
                    source_file = EXCLUDED.source_file
                """,
                batch,
                template="(%s, %s, %s, %s)"
            )
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"Error inserting batch: {e}")
            raise

# Main function
def main():
    args = parse_args()
    
    # Check if GDAL is installed
    if not gdal_available:
        print("ERROR: GDAL is not installed or not in PATH")
        print("Please install GDAL command-line tools to use this script")
        print("The script attempted to install GDAL but was unsuccessful")
        print("See the instructions above for manual installation")
        sys.exit(1)
    
    # Ensure SRTM directory exists
    srtm_dir = os.path.abspath(args.srtm_dir)
    if not os.path.exists(srtm_dir):
        print(f"Creating SRTM directory: {srtm_dir}")
        os.makedirs(srtm_dir)
    
    # Create temp directory for CSV files
    temp_dir = os.path.join(srtm_dir, 'temp')
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)
    
    # Database connection parameters
    db_params = {
        'host': args.db_host,
        'port': args.db_port,
        'dbname': args.db_name,
        'user': args.db_user,
        'password': args.db_password
    }
    
    # Connect to database
    try:
        conn = psycopg2.connect(**db_params)
        conn.autocommit = True
        
        # Initialize database table
        init_database(conn)
        
        # Find all TIFF files
        tiff_files = glob.glob(os.path.join(srtm_dir, '*_DEM.tif'))
        print(f"Found {len(tiff_files)} TIFF files")
        
        # Find all ZIP files
        zip_files = glob.glob(os.path.join(srtm_dir, '*.zip'))
        print(f"Found {len(zip_files)} ZIP files")
        
        # Extract ZIP files if needed
        for zip_path in zip_files:
            zip_basename = os.path.basename(zip_path)
            extracted_name = zip_basename.replace('.zip', '')
            extracted_tiff = f"{extracted_name}_XSAR_DEM.tif"
            extracted_path = os.path.join(srtm_dir, extracted_tiff)
            
            # Check if the extracted file already exists
            if os.path.exists(extracted_path):
                print(f"Extracted file {extracted_tiff} already exists, skipping extraction")
                continue
            
            # Extract the ZIP file
            if extract_zip_file(zip_path, srtm_dir):
                # Add the extracted TIFF to the list if it exists
                if os.path.exists(extracted_path):
                    tiff_files.append(extracted_path)
        
        # Create a queue for CSV files to process
        csv_queue = queue.Queue()
        
        # Start worker threads
        workers = []
        for _ in range(args.threads):
            t = threading.Thread(
                target=process_csv_worker,
                args=(csv_queue, db_params, args.batch_size)
            )
            t.daemon = True
            t.start()
            workers.append(t)
        
        # Process each TIFF file
        for tiff_path in tiff_files:
            tiff_basename = os.path.basename(tiff_path)
            
            # Check if this file has already been imported
            if is_file_imported(conn, tiff_basename):
                print(f"File {tiff_basename} has already been imported, skipping")
                continue
            
            print(f"Processing TIFF file: {tiff_basename}")
            
            # Create a temporary CSV file
            csv_path = os.path.join(temp_dir, f"{os.path.splitext(tiff_basename)[0]}.csv")
            
            # Convert TIFF to CSV
            if tiff_to_csv(tiff_path, csv_path):
                # Add the CSV file to the processing queue
                csv_queue.put((csv_path, tiff_basename))
        
        # Wait for all CSV files to be processed
        csv_queue.join()
        
        # Send poison pills to stop worker threads
        for _ in range(args.threads):
            csv_queue.put(None)
        
        # Wait for all worker threads to finish
        for t in workers:
            t.join()
        
        print("SRTM data import completed successfully")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()